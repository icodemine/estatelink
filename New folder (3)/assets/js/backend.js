(() => {
  "use strict";

  const config = window.EstateLinkSupabaseConfig;
  const sdk = window.supabase;

  if (!config?.url || !config?.publishableKey || !sdk?.createClient) {
    window.EstateLinkBackend = {
      configured: false,
      error: "Supabase could not be initialized. Check the project URL, publishable key, and SDK connection."
    };
    return;
  }

  const client = sdk.createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true
    }
  });
  const noPhoto = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#edf2ef"/><path d="M0 400 275 175l155 135 115-95 255 185v100H0z" fill="#dce7df"/><path d="M295 315v-75l105-87 105 87v75h-70v-58h-70v58z" fill="#86a994"/><text x="400" y="440" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#536d5d">Photo coming soon</text></svg>')}`;

  const propertyColumns = [
    "id", "owner_id", "title", "description", "property_type", "listing_type",
    "price", "currency", "country", "region", "city", "neighborhood",
    "bedrooms", "bathrooms", "size_sqm", "status", "created_at", "updated_at"
  ].join(",");
  const publicPropertyColumns = propertyColumns.split(",").filter((column) => column !== "owner_id").join(",");

  function unwrap(result) {
    if (result.error) throw result.error;
    return result.data;
  }

  function fromDatabaseType(value) {
    return ({
      house: "House",
      apartment: "Apartment",
      land: "Land",
      commercial: "Commercial",
      short_stay: "Short Stay",
      other: "Other"
    })[value] || value;
  }

  function toDatabaseType(value) {
    return ({
      House: "house",
      Apartment: "apartment",
      Land: "land",
      Commercial: "commercial",
      "Short Stay": "short_stay",
      Other: "other"
    })[value] || value.toLowerCase();
  }

  function fromDatabasePurpose(value) {
    return ({
      rent: "Rent",
      sale: "Buy",
      short_stay: "Short Stay"
    })[value] || value;
  }

  function toDatabasePurpose(value) {
    return ({
      Rent: "rent",
      Buy: "sale",
      "Short Stay": "short_stay"
    })[value] || value.toLowerCase();
  }

  function normalizeProperty(row, imageRows = [], advertiser = null) {
    const orderedImages = [...imageRows].sort((a, b) =>
      Number(b.is_cover) - Number(a.is_cover) ||
      String(a.created_at).localeCompare(String(b.created_at))
    );
    const imageUrls = orderedImages.map((image) => image.image_url);
    const listingType = fromDatabasePurpose(row.listing_type);

    return {
      id: row.id,
      ownerId: row.owner_id,
      title: row.title,
      description: row.description,
      category: fromDatabaseType(row.property_type),
      purpose: listingType,
      price: Number(row.price),
      currency: row.currency,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      size: row.size_sqm,
      region: row.region,
      city: row.city,
      neighborhood: row.neighborhood,
      address: [row.neighborhood, row.city, row.region].filter(Boolean).join(", "),
      amenities: [],
      images: imageUrls.length ? imageUrls : [noPhoto],
      image: imageUrls[0] || noPhoto,
      imagePlaceholder: imageUrls.length === 0,
      advertiser: advertiser?.full_name || "Property advertiser",
      advertiserType: advertiser?.role === "agent" ? "Real estate agent" : "Property owner",
      verifiedLabel: "Advertiser not verified",
      added: row.created_at?.slice(0, 10) || "",
      updatedAt: row.updated_at?.slice(0, 10) || row.created_at?.slice(0, 10) || "",
      period: listingType === "Rent" ? "month" : listingType === "Short Stay" ? "night" : "",
      featured: false,
      status: row.status
    };
  }

  async function getImagesFor(propertyIds) {
    if (!propertyIds.length) return new Map();
    const rows = unwrap(await client
      .from("property_images")
      .select("id,property_id,image_url,is_cover,created_at")
      .in("property_id", propertyIds)
      .order("created_at", { ascending: true }));
    const resolvedRows = await Promise.all(rows.map(async (row) => {
      if (/^https?:\/\//i.test(row.image_url)) return row;
      const path = String(row.image_url || "");
      const pathParts = path.split("/");
      if (pathParts.length < 3 || pathParts[1] !== String(row.property_id)) {
        throw new Error("A property image has an invalid Storage path.");
      }
      if (!config.storageBucket) {
        throw new Error("Property images are stored as private paths, but no Storage bucket is configured.");
      }
      const signed = unwrap(await client.storage
        .from(config.storageBucket)
        .createSignedUrl(path, 3600));
      return { ...row, image_url: signed.signedUrl };
    }));
    const imagesByProperty = new Map();
    for (const row of resolvedRows) {
      const images = imagesByProperty.get(row.property_id) || [];
      images.push(row);
      imagesByProperty.set(row.property_id, images);
    }
    return imagesByProperty;
  }

  const backend = {
    configured: true,
    client,
    onAuthStateChange(callback) {
      return client.auth.onAuthStateChange(callback);
    },
    async getSession() {
      return unwrap(await client.auth.getSession()).session;
    },
    async signUp({ email, password, name, role }) {
      return unwrap(await client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: { full_name: name, role }
        }
      }));
    },
    async signIn({ email, password }) {
      return unwrap(await client.auth.signInWithPassword({ email, password }));
    },
    async signOut() {
      unwrap(await client.auth.signOut());
    },
    async getListings() {
      const rows = unwrap(await client
        .from("properties")
        .select(publicPropertyColumns)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(100));
      const imagesByProperty = await getImagesFor(rows.map((row) => row.id));
      return rows.map((row) => normalizeProperty(row, imagesByProperty.get(row.id) || []));
    },
    async getListing(id) {
      const row = unwrap(await client
        .from("properties")
        .select(publicPropertyColumns)
        .eq("id", id)
        .maybeSingle());
      if (!row) return null;
      const imagesByProperty = await getImagesFor([row.id]);
      return normalizeProperty(row, imagesByProperty.get(row.id) || []);
    },
    async getMyListings() {
      const user = unwrap(await client.auth.getUser()).user;
      if (!user) throw new Error("Sign in to load your properties.");
      const rows = unwrap(await client
        .from("properties")
        .select(propertyColumns)
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false }));
      const imagesByProperty = await getImagesFor(rows.map((row) => row.id));
      return rows.map((row) => normalizeProperty(
        row,
        imagesByProperty.get(row.id) || [],
        { full_name: user.user_metadata?.full_name, role: "owner" }
      ));
    },
    async getMyListing(id) {
      const user = unwrap(await client.auth.getUser()).user;
      if (!user) throw new Error("Sign in to load your property.");
      const row = unwrap(await client
        .from("properties")
        .select(propertyColumns)
        .eq("id", id)
        .eq("owner_id", user.id)
        .maybeSingle());
      if (!row) return null;
      const imagesByProperty = await getImagesFor([row.id]);
      return normalizeProperty(
        row,
        imagesByProperty.get(row.id) || [],
        { full_name: user.user_metadata?.full_name, role: "owner" }
      );
    },
    async getProfile() {
      const user = unwrap(await client.auth.getUser()).user;
      if (!user) throw new Error("Sign in to load your profile.");
      return unwrap(await client
        .from("profiles")
        .select("id,full_name,phone,role,whatsapp_phone,public_contact_email,publish_contact_name,publish_contact_phone,publish_contact_whatsapp,publish_contact_email,created_at")
        .eq("id", user.id)
        .maybeSingle());
    },
    async updateProfile(values) {
      const user = unwrap(await client.auth.getUser()).user;
      if (!user) throw new Error("Sign in to update your profile.");
      return unwrap(await client
        .from("profiles")
        .update({
          full_name: values.fullName,
          phone: values.phone || null,
          whatsapp_phone: values.whatsappPhone || null,
          public_contact_email: values.contactEmail || null,
          publish_contact_name: values.publishContactName,
          publish_contact_phone: values.publishContactPhone,
          publish_contact_whatsapp: values.publishContactWhatsapp,
          publish_contact_email: values.publishContactEmail
        })
        .eq("id", user.id)
        .select("id,full_name,phone,role,whatsapp_phone,public_contact_email,publish_contact_name,publish_contact_phone,publish_contact_whatsapp,publish_contact_email,created_at")
        .single());
    },
    async getPublishedListingContact(propertyId) {
      return unwrap(await client.rpc("get_published_property_contact", {
        p_property_id: String(propertyId)
      }).maybeSingle());
    },
    async getFavorites() {
      const user = unwrap(await client.auth.getUser()).user;
      if (!user) throw new Error("Sign in to load your favorites.");
      return unwrap(await client
        .from("favorites")
        .select("property_id")
        .eq("user_id", user.id));
    },
    async addFavorite(propertyId) {
      const user = unwrap(await client.auth.getUser()).user;
      if (!user) throw new Error("Sign in to save favorites to your account.");
      unwrap(await client.from("favorites").insert({
        user_id: user.id,
        property_id: propertyId
      }));
    },
    async removeFavorite(propertyId) {
      const user = unwrap(await client.auth.getUser()).user;
      if (!user) throw new Error("Sign in to remove account favorites.");
      unwrap(await client
        .from("favorites")
        .delete()
        .eq("user_id", user.id)
        .eq("property_id", propertyId));
    },
    async createListing(values, files) {
      const user = unwrap(await client.auth.getUser()).user;
      if (!user) throw new Error("Sign in to submit a property.");
      const userId = user.id;
      if (files.length && !config.storageBucket) {
        throw new Error("Property images are not configured. Set storageBucket in supabase-config.js to an existing Supabase Storage bucket before uploading photos.");
      }
      const payload = {
        owner_id: userId,
        title: values.title,
        description: values.description,
        property_type: toDatabaseType(values.category),
        listing_type: toDatabasePurpose(values.purpose),
        price: Number(values.price),
        currency: values.currency,
        country: "Ghana",
        region: values.region,
        city: values.city,
        neighborhood: values.neighborhood || null,
        bedrooms: values.bedrooms === "" ? null : Number(values.bedrooms),
        bathrooms: values.bathrooms === "" ? null : Number(values.bathrooms),
        size_sqm: values.size === "" ? null : Number(values.size)
      };
      const property = unwrap(await client
        .from("properties")
        .insert(payload)
        .select(propertyColumns)
        .single());

      const uploadedPaths = [];
      try {
        const imageRows = [];
        for (const [index, file] of files.entries()) {
          const extension = file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "");
          const objectPath = `${userId}/${property.id}/${crypto.randomUUID()}${extension ? `.${extension}` : ""}`;
          unwrap(await client.storage.from(config.storageBucket).upload(objectPath, file, {
            cacheControl: "3600",
            contentType: file.type,
            upsert: false
          }));
          uploadedPaths.push(objectPath);
          imageRows.push({
            property_id: property.id,
            image_url: objectPath,
            is_cover: index === 0
          });
        }
        if (imageRows.length) {
          unwrap(await client.from("property_images").insert(imageRows));
        }
        const imagesByProperty = await getImagesFor([property.id]);
        return normalizeProperty(property, imagesByProperty.get(property.id) || []);
      } catch (error) {
        const rollback = await client.from("properties").delete()
          .eq("id", property.id)
          .eq("owner_id", userId);
        if (rollback.error) {
          throw new Error(`${error.message} The property record could not be rolled back: ${rollback.error.message}`);
        }
        if (uploadedPaths.length) {
          const cleanup = await client.storage.from(config.storageBucket).remove(uploadedPaths);
          if (cleanup.error) {
            throw new Error(`${error.message} Uploaded photos could not be removed: ${cleanup.error.message}`);
          }
        }
        throw error;
      }
    },
    async updateListing(id, values) {
      const user = unwrap(await client.auth.getUser()).user;
      if (!user) throw new Error("Sign in to update your property.");
      const payload = {
        title: values.title,
        price: Number(values.price),
        description: values.description,
        updated_at: new Date().toISOString()
      };
      if (values.category !== undefined) payload.property_type = toDatabaseType(values.category);
      if (values.purpose !== undefined) payload.listing_type = toDatabasePurpose(values.purpose);
      if (values.currency !== undefined) payload.currency = values.currency;
      if (values.region !== undefined) payload.region = values.region;
      if (values.city !== undefined) payload.city = values.city;
      if (values.neighborhood !== undefined) payload.neighborhood = values.neighborhood || null;
      if (values.bedrooms !== undefined) payload.bedrooms = values.bedrooms === "" ? null : Number(values.bedrooms);
      if (values.bathrooms !== undefined) payload.bathrooms = values.bathrooms === "" ? null : Number(values.bathrooms);
      if (values.size !== undefined) payload.size_sqm = values.size === "" ? null : Number(values.size);
      const row = unwrap(await client
        .from("properties")
        .update(payload)
        .eq("id", id)
        .eq("owner_id", user.id)
        .select(propertyColumns)
        .single());
      return normalizeProperty(row);
    },
    async deleteListing(id) {
      const user = unwrap(await client.auth.getUser()).user;
      if (!user) throw new Error("Sign in to delete your property.");
      const imageRows = unwrap(await client
        .from("property_images")
        .select("image_url")
        .eq("property_id", id));
      const objectPaths = imageRows
        .map((row) => row.image_url)
        .filter((path) => typeof path === "string" && !/^https?:\/\//i.test(path));
      const deleted = unwrap(await client
        .from("properties")
        .delete()
        .eq("id", id)
        .eq("owner_id", user.id)
        .select("id")
        .maybeSingle());
      if (!deleted) throw new Error("This property could not be deleted. It may no longer belong to your account.");
      if (objectPaths.length && config.storageBucket) {
        const cleanup = await client.storage.from(config.storageBucket).remove(objectPaths);
        if (cleanup.error) {
          throw new Error(`The listing was deleted, but its photos could not be removed from Storage: ${cleanup.error.message}`);
        }
      }
    }
  };

  window.EstateLinkBackend = backend;
})();
