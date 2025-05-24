const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { AuthenticationError, UserInputError, ApolloError } = require('apollo-server-express');
const { PubSub } = require('graphql-subscriptions');
const { getDB } = require('../db');
const { JWT_SECRET, ...config } = require('../config');
const { ObjectId } = require('mongodb');
const slugify = require('../utils/slugify');

const pubsub = new PubSub();
const ORDER_STATUS_CHANGED_TOPIC = 'ORDER_STATUS_CHANGED';

const USERS_COLLECTION = 'users';
const STORES_COLLECTION = 'stores';
const CATEGORIES_COLLECTION = 'categories';
const PRODUCTS_COLLECTION = 'products';
const ORDERS_COLLECTION = 'orders';
const REVIEWS_COLLECTION = 'reviews'; // New collection

// --- Helper Functions for Output Transformation ---

const transformAttribute = (attribute) => { /* ... existing ... */
  if (!attribute) return null;
  return { key: attribute.key, value: attribute.value };
};
const transformAddonOption = (option) => { /* ... existing ... */
  if (!option) return null;
  return { ...option, _id: (option._id || new ObjectId()).toHexString() };
};
const transformAddon = (addon) => { /* ... existing ... */
  if (!addon) return null;
  return {
    ...addon,
    _id: (addon._id || new ObjectId()).toHexString(),
    options: addon.options ? addon.options.map(transformAddonOption) : [],
  };
};
const transformVariation = (variation) => { /* ... existing ... */
  if (!variation) return null;
  return {
    ...variation,
    _id: (variation._id || new ObjectId()).toHexString(),
    addons: variation.addons ? variation.addons.map(transformAddon) : [],
  };
};

// Updated transformProduct
const transformProduct = (product, isSnapshot = false) => {
  if (!product) return null;
  const id = product._id ? product._id.toHexString() : (isSnapshot ? null : new ObjectId().toHexString());
  return {
    ...product, _id: id, title: product.title || "N/A", image: product.image || null,
    description: product.description || null,
    variations: product.variations ? product.variations.map(v => transformVariation(v)) : [],
    isAvailable: product.isAvailable !== undefined ? product.isAvailable : true,
    categoryId: product.categoryId ? (typeof product.categoryId === 'string' ? product.categoryId : product.categoryId.toHexString()) : null,
    storeId: product.storeId ? (typeof product.storeId === 'string' ? product.storeId : product.storeId.toHexString()) : null,
    brand: product.brand || null,
    sku: product.sku || null,
    volumeMl: product.volumeMl || null,
    nicotineMg: product.nicotineMg || null,
    attributes: product.attributes ? product.attributes.map(transformAttribute) : [],
    // Review aggregates - provide defaults
    averageRating: product.averageRating || 0.0,
    reviewCount: product.reviewCount || 0,
    // reviews field will be handled by Product.reviews field resolver
  };
};

// Updated transformStore
const transformStore = async (db, store, isSnapshot = false) => {
  if (!store) return null;
  const id = store._id ? store._id.toHexString() : (isSnapshot ? null : new ObjectId().toHexString());
  let categories = [];
  if (!isSnapshot && store.categoryIds && store.categoryIds.length > 0) {
    const categoryObjectIds = store.categoryIds.map(catId => new ObjectId(catId));
    const fetchedCategories = await db.collection(CATEGORIES_COLLECTION).find({ _id: { $in: categoryObjectIds } }).toArray();
    categories = await Promise.all(fetchedCategories.map(cat => transformCategory(db, cat)));
  } else if (store.categories && !isSnapshot) {
    categories = await Promise.all(store.categories.map(cat => transformCategory(db, cat)));
  } else if (isSnapshot && store.categories) {
     categories = store.categories; 
  }
  return {
    ...store, _id: id, name: store.name || "N/A", image: store.image || null,
    slug: store.slug || (store.name ? slugify(store.name) : null),
    address: store.address || "N/A", location: store.location,
    estimatedDeliveryTime: store.estimatedDeliveryTime || null,
    minimumOrder: store.minimumOrder, tax: store.tax,
    reviewData: store.reviewData || { total: 0, ratings: 0.0 }, // DEPRECATED
    rating: store.rating || (store.reviewData ? store.reviewData.ratings : 0.0), // DEPRECATED
    zone: store.zone || null, categories: categories, openingTimes: store.openingTimes || [],
    isAvailable: store.isAvailable !== undefined ? store.isAvailable : true,
    licenseNumber: store.licenseNumber || null,
    storeType: store.storeType || "GENERAL_MERCHANDISE",
    // Review aggregates - provide defaults
    averageRating: store.averageRating || 0.0,
    reviewCount: store.reviewCount || 0,
    // reviews field will be handled by Store.reviews field resolver
  };
};

const transformCategory = async (db, category) => { /* ... existing ... */
  if (!category) return null;
  let products = [];
  if (category.productIds && category.productIds.length > 0) {
     const productObjectIds = category.productIds.map(id => new ObjectId(id));
     products = await db.collection(PRODUCTS_COLLECTION).find({ _id: { $in: productObjectIds } }).toArray();
     products = products.map(p => transformProduct(p));
  } else {
    products = category.products ? category.products.map(p => transformProduct(p)) : [];
  }
  return {
    ...category, _id: category._id.toHexString(), products: products,
    storeId: category.storeId ? (typeof category.storeId === 'string' ? category.storeId : category.storeId.toHexString()) : null,
  };
};
const transformAddressOutput = (address, isSnapshot = false) => { /* ... existing ... */
  if (!address) return null;
  const id = address._id ? address._id.toHexString() : (isSnapshot ? null : new ObjectId().toHexString());
  return { 
    ...address, _id: id, label: address.label || null, deliveryAddress: address.deliveryAddress || "N/A",
    details: address.details || null, location: address.location,
    selected: address.selected !== undefined ? address.selected : null,
  };
};
const findUserAndTransform = async (db, userId) => { /* ... existing ... */
  const user = await db.collection(USERS_COLLECTION).findOne({ _id: userId });
  if (!user) return null;
  return {
    ...user, 
    _id: user._id.toHexString(), 
    id: user._id.toHexString(),
    name: user.name || "N/A", 
    email: user.email || "N/A", 
    phone: user.phone || null,
    addresses: user.addresses && user.addresses.length > 0 ? user.addresses.map(addr => transformAddressOutput(addr)) : [],
    idImageUrl: user.idImageUrl || null,
    idVerificationStatus: user.idVerificationStatus || "NOT_UPLOADED",
    dateOfBirth: user.dateOfBirth || null,
    idRejectionReason: user.idRejectionReason || null,
    emailIsVerified: user.emailIsVerified || false,
    phoneIsVerified: user.phoneIsVerified || false,
  };
};
const transformOrderItem = async (db, orderItem) => { /* ... existing ... */
  return {
    ...orderItem, _id: orderItem._id.toHexString(),
    productSnapshot: transformProduct(orderItem.productSnapshot, true), 
    variationSnapshot: transformVariation(orderItem.variationSnapshot),
    selectedAddons: orderItem.selectedAddons.map(sa => ({ ...sa })),
  };
};
const transformOrder = async (db, order) => { /* ... existing ... */
  if (!order) return null;
  const items = await Promise.all(order.items.map(item => transformOrderItem(db, item)));
  const user = await findUserAndTransform(db, new ObjectId(order.userId));
  const store = await transformStore(db, order.storeSnapshot, true); 
  return {
    ...order, _id: order._id.toHexString(), user: user || { id: order.userId.toHexString(), name: "User not found" },
    store: store || { _id: order.storeId.toHexString(), name: "Store not found" },
    items: items, deliveryAddress: transformAddressOutput(order.deliveryAddress, true),
    orderDate: new Date(order.orderDate).toISOString(), createdAt: new Date(order.createdAt).toISOString(),
    updatedAt: new Date(order.updatedAt).toISOString(),
    expectedDeliveryTime: order.expectedDeliveryTime ? new Date(order.expectedDeliveryTime).toISOString() : null,
    confirmedAt: order.confirmedAt ? new Date(order.confirmedAt).toISOString() : null,
    preparingAt: order.preparingAt ? new Date(order.preparingAt).toISOString() : null,
    readyForPickupAt: order.readyForPickupAt ? new Date(order.readyForPickupAt).toISOString() : null,
    pickedUpAt: order.pickedUpAt ? new Date(order.pickedUpAt).toISOString() : null,
    deliveredAt: order.deliveredAt ? new Date(order.deliveredAt).toISOString() : null,
    cancelledAt: order.cancelledAt ? new Date(order.cancelledAt).toISOString() : null,
    rejectedAt: order.rejectedAt ? new Date(order.rejectedAt).toISOString() : null,
    paymentStatus: order.paymentStatus || "PENDING",
    mockPaymentTransactionId: order.mockPaymentTransactionId || null,
    deliveryIdImageUrl: order.deliveryIdImageUrl || null,
    deliveryVerificationTimestamp: order.deliveryVerificationTimestamp ? new Date(order.deliveryVerificationTimestamp).toISOString() : null,
    deliveryRecipientNameMatchesId: order.deliveryRecipientNameMatchesId === undefined ? null : order.deliveryRecipientNameMatchesId,
    deliveryRecipientIsOfLegalAge: order.deliveryRecipientIsOfLegalAge === undefined ? null : order.deliveryRecipientIsOfLegalAge,
  };
};

// New transformReview helper
const transformReview = async (db, review) => {
  if (!review) return null;
  const user = await findUserAndTransform(db, new ObjectId(review.userId));
  return {
    ...review,
    _id: review._id.toHexString(),
    user: user || { id: review.userId.toHexString(), name: "User not found" }, // Populate user
    createdAt: new Date(review.createdAt).toISOString(),
    updatedAt: new Date(review.updatedAt).toISOString(),
  };
};

// New helper to update review aggregates
const updateTargetReviewAggregates = async (db, targetId, targetType) => {
  const reviews = await db.collection(REVIEWS_COLLECTION).find({ 
    targetId: new ObjectId(targetId), 
    targetType: targetType 
  }).toArray();

  const reviewCount = reviews.length;
  const averageRating = reviewCount > 0 
    ? reviews.reduce((sum, rev) => sum + rev.rating, 0) / reviewCount 
    : 0.0;

  const collectionToUpdate = targetType === "STORE" ? STORES_COLLECTION : PRODUCTS_COLLECTION;
  
  await db.collection(collectionToUpdate).updateOne(
    { _id: new ObjectId(targetId) },
    { $set: { 
        averageRating: parseFloat(averageRating.toFixed(2)), // Store with 2 decimal places
        reviewCount: reviewCount,
        updatedAt: new Date() 
      } 
    }
  );
};


// --- Resolvers ---
const resolvers = {
  Query: {
    // ... (Existing Query resolvers) ...
    getConfiguration: () => { /* ... existing ... */
        return {
            _id: "global_configuration", currency: config.APP_CURRENCY, currencySymbol: config.APP_CURRENCY_SYMBOL,
            deliveryRatePerKm: config.DELIVERY_RATE_PER_KM, maxDeliveryDistanceKm: config.MAX_DELIVERY_DISTANCE_KM,
            googleApiKey: config.GOOGLE_API_KEY_CLIENT, stripePublishableKey: config.STRIPE_PUBLISHABLE_KEY_CLIENT,
            twilioEnabled: config.TWILIO_ENABLED, skipEmailVerification: config.SKIP_EMAIL_VERIFICATION,
            skipMobileVerification: config.SKIP_MOBILE_VERIFICATION, appMinimumVersion: config.APP_MINIMUM_VERSION,
            defaultAgeLimit: config.DEFAULT_AGE_LIMIT, idImageStorageBucket: config.ID_IMAGE_STORAGE_BUCKET,
        };
    },
    health: () => 'Server is up and running!',
    userProfile: async (_, __, context) => { /* ... existing ... */
      if (!context.user || !context.user.id) throw new AuthenticationError('Not authenticated.');
      const db = getDB();
      return findUserAndTransform(db, new ObjectId(context.user.id));
    },
    nearByStores: async (_, { latitude, longitude, radius }) => { /* ... existing ... */
      const db = getDB();
      const searchRadiusMeters = (radius || 5.0) * 1000;
      const stores = await db.collection(STORES_COLLECTION).find({
        location: { $nearSphere: { $geometry: { type: "Point", coordinates: [longitude, latitude] }, $maxDistance: searchRadiusMeters } }
      }).toArray();
      return Promise.all(stores.map(s => transformStore(db, s)));
    },
    store: async (_, { id, slug }) => { /* ... existing ... */
      if (!id && !slug) throw new UserInputError("Either ID or slug must be provided.");
      const db = getDB();
      const query = id ? { _id: new ObjectId(id) } : { slug: slug };
      const storeDoc = await db.collection(STORES_COLLECTION).findOne(query);
      if (!storeDoc) return null;
      return transformStore(db, storeDoc);
    },
    myOrders: async (_, { offset = 0, limit = 10 }, context) => { /* ... existing ... */
      if (!context.user || !context.user.id) throw new AuthenticationError('Not authenticated.');
      const db = getDB();
      const userIdObj = new ObjectId(context.user.id);
      const orders = await db.collection(ORDERS_COLLECTION)
        .find({ userId: userIdObj })
        .sort({ orderDate: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();
      return Promise.all(orders.map(order => transformOrder(db, order)));
    },
    orderDetails: async (_, { orderId }, context) => { /* ... existing ... */
      if (!context.user || !context.user.id) throw new AuthenticationError('Not authenticated.');
      const db = getDB();
      let orderDoc;
      if (ObjectId.isValid(orderId)) {
        orderDoc = await db.collection(ORDERS_COLLECTION).findOne({ _id: new ObjectId(orderId), userId: new ObjectId(context.user.id) });
      }
      if (!orderDoc) {
         orderDoc = await db.collection(ORDERS_COLLECTION).findOne({ orderId: orderId, userId: new ObjectId(context.user.id) });
      }
      if (!orderDoc) throw new AuthenticationError('Order not found or access denied.');
      return transformOrder(db, orderDoc);
    },
    // New Review Queries
    reviewsForStore: async (_, { storeId, offset = 0, limit = 10 }) => {
      const db = getDB();
      const reviews = await db.collection(REVIEWS_COLLECTION)
        .find({ targetId: new ObjectId(storeId), targetType: "STORE" })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();
      return Promise.all(reviews.map(review => transformReview(db, review)));
    },
    reviewsForProduct: async (_, { productId, offset = 0, limit = 10 }) => {
      const db = getDB();
      const reviews = await db.collection(REVIEWS_COLLECTION)
        .find({ targetId: new ObjectId(productId), targetType: "PRODUCT" })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();
      return Promise.all(reviews.map(review => transformReview(db, review)));
    },
  },
  Mutation: {
    // ... (Existing mutations: register, login, etc.)
    register: async (_, { name, email, password, phone }) => { /* ... existing ... */ 
      const db = getDB();
      const existingUser = await db.collection(USERS_COLLECTION).findOne({ email });
      if (existingUser) throw new UserInputError('Email already in use.');
      if (password.length < 6) throw new UserInputError('Password too short.');
      const hashedPassword = await bcrypt.hash(password, 12);
      const newUserDoc = {
        _id: new ObjectId(), name, email, password: hashedPassword, phone: phone || null,
        emailIsVerified: false, phoneIsVerified: false, addresses: [], createdAt: new Date(), updatedAt: new Date(),
        idImageUrl: null, idVerificationStatus: "NOT_UPLOADED", dateOfBirth: null, idRejectionReason: null,
      };
      await db.collection(USERS_COLLECTION).insertOne(newUserDoc);
      const token = jwt.sign({ id: newUserDoc._id.toHexString(), email: newUserDoc.email }, JWT_SECRET, { expiresIn: '1h' });
      return { token, userId: newUserDoc._id.toHexString(), name: newUserDoc.name, email: newUserDoc.email };
    },
    login: async (_, { email, password }) => { /* ... existing ... */ 
        const db = getDB();
        const user = await db.collection(USERS_COLLECTION).findOne({ email });
        if (!user) throw new AuthenticationError('Invalid credentials.');
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) throw new AuthenticationError('Invalid credentials.');
        const token = jwt.sign({ id: user._id.toHexString(), email: user.email }, JWT_SECRET, { expiresIn: '1h' });
        return { token, userId: user._id.toHexString(), name: user.name, email: user.email };
    },
    updateUserProfile: async (_, { name, phone }, context) => { /* ... existing ... */ 
        if (!context.user) throw new AuthenticationError('Not authenticated.');
        const db = getDB();
        const userIdObj = new ObjectId(context.user.id);
        const updates = {updatedAt: new Date()};
        if (name !== undefined) updates.name = name;
        if (phone !== undefined) { updates.phone = phone; updates.phoneIsVerified = false; }
        if (Object.keys(updates).length <= 1 && Object.keys(updates).includes("updatedAt")) {
             throw new UserInputError('No updates provided.');
        }
        await db.collection(USERS_COLLECTION).updateOne({ _id: userIdObj }, { $set: updates });
        return findUserAndTransform(db, userIdObj);
    },
    sendOtpToEmail: async (_, { email }) => { console.log(`OTP for email ${email} (simulated)`); return true; },
    verifyEmailOtp: async (_, { email, otp }) => { /* ... existing ... */ 
        console.log(`Verify OTP for email ${email} with ${otp} (simulated)`);
        const db = getDB();
        const user = await db.collection(USERS_COLLECTION).findOne({ email });
        if (!user) throw new UserInputError('User not found.');
        if (otp !== '123456') throw new UserInputError('Invalid OTP.');
        await db.collection(USERS_COLLECTION).updateOne({ _id: user._id }, { $set: { emailIsVerified: true, updatedAt: new Date() } });
        const token = jwt.sign({ id: user._id.toHexString(), email: user.email }, JWT_SECRET, { expiresIn: '1h' });
        return { token, userId: user._id.toHexString(), name: user.name, email: user.email };
    },
    sendOtpToPhone: async (_, { phone }) => { console.log(`OTP for phone ${phone} (simulated)`); return true; },
    verifyPhoneOtp: async (_, { otp }, context) => { /* ... existing ... */ 
        if (!context.user) throw new AuthenticationError('Not authenticated.');
        const db = getDB();
        const userIdObj = new ObjectId(context.user.id);
        const user = await db.collection(USERS_COLLECTION).findOne({ _id: userIdObj });
        if (!user) throw new AuthenticationError('User not found.');
        if (!user.phone) throw new UserInputError('No phone associated.');
        if (otp !== '123456') throw new UserInputError('Invalid OTP.');
        await db.collection(USERS_COLLECTION).updateOne({ _id: userIdObj }, { $set: { phoneIsVerified: true, updatedAt: new Date() } });
        const token = jwt.sign({ id: userIdObj.toHexString(), email: user.email }, JWT_SECRET, { expiresIn: '1h' });
        return { token, userId: userIdObj.toHexString(), name: user.name, email: user.email };
    },
    createAddress: async (_, { addressInput }, context) => { /* ... existing ... */
        if (!context.user) throw new AuthenticationError('Not authenticated.');
        const db = getDB();
        const userIdObj = new ObjectId(context.user.id);
        const userDoc = await db.collection(USERS_COLLECTION).findOne({ _id: userIdObj }); 
        if (!userDoc) throw new AuthenticationError('User not found.');
        const newAddress = {
            _id: new ObjectId(), label: addressInput.label, deliveryAddress: addressInput.deliveryAddress,
            details: addressInput.details, location: { type: addressInput.location.type || "Point", coordinates: addressInput.location.coordinates },
            selected: !userDoc.addresses || userDoc.addresses.length === 0,
        };
        await db.collection(USERS_COLLECTION).updateOne({ _id: userIdObj }, { $push: { addresses: newAddress }, $set: {updatedAt: new Date()} });
        if (newAddress.selected && userDoc.addresses && userDoc.addresses.length > 0) {
            await db.collection(USERS_COLLECTION).updateOne(
              { _id: userIdObj, "addresses._id": { $ne: newAddress._id } },
              { $set: { "addresses.$[elem].selected": false } },
              { arrayFilters: [{ "elem.selected": true }] }
            );
        }
        return findUserAndTransform(db, userIdObj);
    },
    updateAddress: async (_, { addressId, addressInput }, context) => { /* ... existing ... */
        if (!context.user) throw new AuthenticationError('Not authenticated.');
        const db = getDB();
        const userIdObj = new ObjectId(context.user.id);
        const addressIdObj = new ObjectId(addressId);
        const updates = {};
        if (addressInput.label !== undefined) updates["addresses.$.label"] = addressInput.label;
        if (addressInput.deliveryAddress !== undefined) updates["addresses.$.deliveryAddress"] = addressInput.deliveryAddress;
        if (addressInput.details !== undefined) updates["addresses.$.details"] = addressInput.details;
        if (addressInput.location) {
            updates["addresses.$.location.type"] = addressInput.location.type || "Point";
            updates["addresses.$.location.coordinates"] = addressInput.location.coordinates;
        }
        if (Object.keys(updates).length === 0) throw new UserInputError('No fields to update.');
        await db.collection(USERS_COLLECTION).updateOne({ _id: userIdObj, "addresses._id": addressIdObj }, { $set: updates, $currentDate: {updatedAt: true} });
        return findUserAndTransform(db, userIdObj);
    },
    deleteAddress: async (_, { addressId }, context) => { /* ... existing ... */
        if (!context.user) throw new AuthenticationError('Not authenticated.');
        const db = getDB();
        const userIdObj = new ObjectId(context.user.id);
        const addressIdObj = new ObjectId(addressId);
        const user = await db.collection(USERS_COLLECTION).findOne({ _id: userIdObj });
        const addressToDelete = user.addresses.find(addr => addr._id.equals(addressIdObj));
        if (!addressToDelete) throw new UserInputError("Address not found.");
        await db.collection(USERS_COLLECTION).updateOne({ _id: userIdObj }, { $pull: { addresses: { _id: addressIdObj } }, $set: {updatedAt: new Date()} });
        if (addressToDelete.selected) {
            const updatedUser = await db.collection(USERS_COLLECTION).findOne({ _id: userIdObj });
            if (updatedUser.addresses && updatedUser.addresses.length > 0) {
                await db.collection(USERS_COLLECTION).updateOne(
                  { _id: userIdObj, "addresses._id": updatedUser.addresses[0]._id },
                  { $set: { "addresses.$.selected": true } }
                );
            }
        }
        return findUserAndTransform(db, userIdObj);
    },
    selectAddress: async (_, { addressId }, context) => { /* ... existing ... */
        if (!context.user) throw new AuthenticationError('Not authenticated.');
        const db = getDB();
        const userIdObj = new ObjectId(context.user.id);
        const addressIdObj = new ObjectId(addressId);
        await db.collection(USERS_COLLECTION).updateOne({ _id: userIdObj }, { $set: { "addresses.$[].selected": false, updatedAt: new Date() } });
        await db.collection(USERS_COLLECTION).updateOne({ _id: userIdObj, "addresses._id": addressIdObj }, { $set: { "addresses.$.selected": true } });
        return findUserAndTransform(db, userIdObj);
    },
    _ensureStoreIndex: async () => { /* ... existing ... */
      console.log("Ensure a 2dsphere index exists on 'stores.location' for geospatial queries. Mongo shell command: db.stores.createIndex({ location: '2dsphere' })");
      return true;
    },
    createStore: async (_, { input }) => { /* ... existing ... */
        const db = getDB();
        const newStore = {
            _id: new ObjectId(), name: input.name, image: input.image || null, slug: input.slug || slugify(input.name),
            address: input.address, location: { type: "Point", coordinates: input.location.coordinates },
            estimatedDeliveryTime: input.estimatedDeliveryTime || null, minimumOrder: input.minimumOrder || 0, tax: input.tax || 0,
            openingTimes: input.openingTimes ? input.openingTimes.map(ot => ({ day: ot.day, times: ot.times ? ot.times.map(ts => ({ startTime: ts.startTime, endTime: ts.endTime })) : [] })) : [],
            isAvailable: input.isAvailable !== undefined ? input.isAvailable : true, categoryIds: [],
            reviewData: { total: 0, ratings: 0.0 }, rating: 0.0, // DEPRECATED
            averageRating: 0.0, reviewCount: 0, // Initialize new review fields
            createdAt: new Date(), updatedAt: new Date(),
            licenseNumber: input.licenseNumber || null, storeType: input.storeType || "GENERAL_MERCHANDISE",
        };
        await db.collection(STORES_COLLECTION).insertOne(newStore);
        return transformStore(db, newStore);
    },
    updateStore: async (_, { id, input }) => { /* ... existing ... */
        const db = getDB();
        const storeIdObj = new ObjectId(id);
        const updates = { updatedAt: new Date() };
        if (input.name) { updates.name = input.name; updates.slug = input.slug || slugify(input.name); }
        if (input.slug) updates.slug = input.slug;
        if (input.image !== undefined) updates.image = input.image;
        if (input.address) updates.address = input.address;
        if (input.location) updates.location = { type: "Point", coordinates: input.location.coordinates };
        if (input.estimatedDeliveryTime !== undefined) updates.estimatedDeliveryTime = input.estimatedDeliveryTime;
        if (input.minimumOrder !== undefined) updates.minimumOrder = input.minimumOrder;
        if (input.tax !== undefined) updates.tax = input.tax;
        if (input.openingTimes) updates.openingTimes = input.openingTimes.map(ot => ({ day: ot.day, times: ot.times ? ot.times.map(ts => ({startTime: ts.startTime, endTime: ts.endTime})) : [] }));
        if (input.isAvailable !== undefined) updates.isAvailable = input.isAvailable;
        if (input.licenseNumber !== undefined) updates.licenseNumber = input.licenseNumber;
        if (input.storeType !== undefined) updates.storeType = input.storeType;
        await db.collection(STORES_COLLECTION).updateOne({ _id: storeIdObj }, { $set: updates });
        const updatedStoreDoc = await db.collection(STORES_COLLECTION).findOne({ _id: storeIdObj });
        return transformStore(db, updatedStoreDoc);
    },
    createCategory: async (_, { input }) => { /* ... existing ... */
        const db = getDB();
        const storeIdObj = new ObjectId(input.storeId);
        const store = await db.collection(STORES_COLLECTION).findOne({ _id: storeIdObj });
        if (!store) throw new UserInputError("Store not found for this category.");
        const newCategoryDoc = {
            _id: new ObjectId(), title: input.title, storeId: storeIdObj, productIds: [],
            createdAt: new Date(), updatedAt: new Date(),
        };
        await db.collection(CATEGORIES_COLLECTION).insertOne(newCategoryDoc);
        await db.collection(STORES_COLLECTION).updateOne({ _id: storeIdObj }, { $addToSet: { categoryIds: newCategoryDoc._id }, $currentDate: {updatedAt: true} });
        return transformCategory(db, newCategoryDoc);
    },
    updateCategory: async (_, { id, input }) => { /* ... existing ... */
        const db = getDB();
        const categoryIdObj = new ObjectId(id);
        const updates = { updatedAt: new Date() };
        if (input.title) updates.title = input.title;
        await db.collection(CATEGORIES_COLLECTION).updateOne({ _id: categoryIdObj }, { $set: updates });
        const updatedDoc = await db.collection(CATEGORIES_COLLECTION).findOne({ _id: categoryIdObj });
        return transformCategory(db, updatedDoc);
    },
    createProduct: async (_, { input }) => { /* ... existing ... */
        const db = getDB();
        const categoryIdObj = new ObjectId(input.categoryId);
        const storeIdObj = new ObjectId(input.storeId);
        const category = await db.collection(CATEGORIES_COLLECTION).findOne({ _id: categoryIdObj, storeId: storeIdObj });
        if (!category) throw new UserInputError("Category not found or not associated with the given store.");
        const newProduct = {
            _id: new ObjectId(), title: input.title, image: input.image || null, description: input.description || null,
            variations: input.variations ? input.variations.map(v => ({ _id: new ObjectId(), title: v.title, price: v.price, discounted: v.discounted || null, addons: v.addons ? v.addons.map(a => ({ _id: new ObjectId(), title: a.title, description: a.description || null, options: a.options ? a.options.map(o => ({ _id: new ObjectId(), title: o.title, description: o.description || null, price: o.price })) : [], quantityMinimum: a.quantityMinimum, quantityMaximum: a.quantityMaximum })) : [] })) : [],
            categoryId: categoryIdObj, storeId: storeIdObj,
            isAvailable: input.isAvailable !== undefined ? input.isAvailable : true,
            createdAt: new Date(), updatedAt: new Date(),
            brand: input.brand || null, sku: input.sku || null, volumeMl: input.volumeMl || null,
            nicotineMg: input.nicotineMg || null,
            attributes: input.attributes ? input.attributes.map(attr => ({ key: attr.key, value: attr.value })) : [],
            averageRating: 0.0, reviewCount: 0, // Initialize new review fields
        };
        await db.collection(PRODUCTS_COLLECTION).insertOne(newProduct);
        await db.collection(CATEGORIES_COLLECTION).updateOne(
          { _id: categoryIdObj },
          { $addToSet: { productIds: newProduct._id }, $currentDate: {updatedAt: true} }
        );
        return transformProduct(newProduct);
    },
    updateProduct: async (_, { id, input }) => { /* ... existing ... */
        const db = getDB();
        const productIdObj = new ObjectId(id);
        const updates = { updatedAt: new Date() };
        if (input.title) updates.title = input.title;
        if (input.image !== undefined) updates.image = input.image;
        if (input.description !== undefined) updates.description = input.description;
        if (input.isAvailable !== undefined) updates.isAvailable = input.isAvailable;
        if (input.variations) { 
            updates.variations = input.variations.map(v => ({
                _id: v._id ? new ObjectId(v._id) : new ObjectId(), title: v.title, price: v.price, discounted: v.discounted || null,
                addons: v.addons ? v.addons.map(a => ({ _id: a._id ? new ObjectId(a._id) : new ObjectId(), title: a.title, description: a.description || null, options: a.options ? a.options.map(o => ({ _id: o._id ? new ObjectId(o._id) : new ObjectId(), title: o.title, description: o.description || null, price: o.price })) : [], quantityMinimum: a.quantityMinimum, quantityMaximum: a.quantityMaximum })) : [],
            }));
        }
        if (input.brand !== undefined) updates.brand = input.brand;
        if (input.sku !== undefined) updates.sku = input.sku;
        if (input.volumeMl !== undefined) updates.volumeMl = input.volumeMl;
        if (input.nicotineMg !== undefined) updates.nicotineMg = input.nicotineMg;
        if (input.attributes !== undefined) updates.attributes = input.attributes.map(attr => ({ key: attr.key, value: attr.value }));
        await db.collection(PRODUCTS_COLLECTION).updateOne({ _id: productIdObj }, { $set: updates });
        const updatedProductDoc = await db.collection(PRODUCTS_COLLECTION).findOne({ _id: productIdObj });
        return transformProduct(updatedProductDoc);
    },
    placeOrder: async (_, { storeId, items, paymentMethod, addressId, tipping, notes, preparationTimeMinutes }, context) => { /* ... existing ... */
      if (!context.user || !context.user.id) throw new AuthenticationError('Not authenticated.');
      const db = getDB();
      const userIdObj = new ObjectId(context.user.id);
      const user = await db.collection(USERS_COLLECTION).findOne({ _id: userIdObj });
      if (!user) throw new AuthenticationError('User not found.');
      if (user.idVerificationStatus !== "VERIFIED") {
        throw new AuthenticationError('Your ID has not been verified yet. Please complete ID verification to place an order.');
      }
      const deliveryAddress = user.addresses.find(addr => addr._id.equals(new ObjectId(addressId)));
      if (!deliveryAddress) throw new UserInputError('Delivery address not found for user.');
      const storeObjId = new ObjectId(storeId);
      const store = await db.collection(STORES_COLLECTION).findOne({ _id: storeObjId });
      if (!store || !store.isAvailable) throw new UserInputError('Store not found or is currently unavailable.');
      let subTotal = 0;
      const orderItems = [];
      for (const itemInput of items) { 
            const productObjId = new ObjectId(itemInput.productId);
            const product = await db.collection(PRODUCTS_COLLECTION).findOne({ _id: productObjId, storeId: storeObjId });
            if (!product || !product.isAvailable) throw new UserInputError(`Product ${itemInput.productId} not found or unavailable.`);
            const variation = product.variations.find(v => v._id.equals(new ObjectId(itemInput.variationId)));
            if (!variation) throw new UserInputError(`Variation ${itemInput.variationId} not found for product ${itemInput.productId}.`);
            let currentItemUnitPrice = variation.discounted !== null && variation.discounted < variation.price ? variation.discounted : variation.price;
            const selectedAddonsSnapshots = [];
            if (itemInput.addons && itemInput.addons.length > 0) {
                for (const addonInput of itemInput.addons) {
                    const addonDef = variation.addons.find(a => a._id.equals(new ObjectId(addonInput.addonId)));
                    if (!addonDef) throw new UserInputError(`Addon ${addonInput.addonId} not found in variation.`);
                    const optionDef = addonDef.options.find(o => o._id.equals(new ObjectId(addonInput.selectedOptionId)));
                    if (!optionDef) throw new UserInputError(`Addon option ${addonInput.selectedOptionId} not found for addon ${addonInput.addonId}.`);
                    currentItemUnitPrice += optionDef.price;
                    selectedAddonsSnapshots.push({ addonTitle: addonDef.title, optionTitle: optionDef.title, priceAtOrder: optionDef.price });
                }
            }
            const productSnapshot = { _id: product._id, title: product.title, image: product.image, brand: product.brand, sku: product.sku, volumeMl: product.volumeMl, nicotineMg: product.nicotineMg, attributes: product.attributes };
            const variationSnapshot = { _id: variation._id, title: variation.title, price: variation.price, discounted: variation.discounted };
            orderItems.push({
                _id: new ObjectId(), productId: product._id, productSnapshot: productSnapshot,
                variationId: variation._id, variationSnapshot: variationSnapshot, quantity: itemInput.quantity,
                selectedAddons: selectedAddonsSnapshots, unitPrice: currentItemUnitPrice,
                totalItemPrice: currentItemUnitPrice * itemInput.quantity,
            });
            subTotal += currentItemUnitPrice * itemInput.quantity;
      }
      const storeTaxRate = store.tax || 0;
      const taxAmount = subTotal * (storeTaxRate / 100);
      const deliveryCharges = 5.0; 
      const finalTipping = tipping || 0;
      const totalAmount = subTotal + taxAmount + deliveryCharges + finalTipping;
      const now = new Date();
      const mockTransactionId = `MOCK_TXN_${new ObjectId().toHexString()}`;
      const paymentStatus = "SUCCESSFUL";
      const newOrder = {
        _id: new ObjectId(), orderId: `ORD-${now.getTime().toString().slice(-6)}-${String(Math.floor(Math.random()*1000)).padStart(3,'0')}`,
        userId: userIdObj, storeId: storeObjId,
        storeSnapshot: { _id: store._id, name: store.name, image: store.image, address: store.address, storeType: store.storeType, licenseNumber: store.licenseNumber },
        items: orderItems, deliveryAddress: { ...deliveryAddress, _id: deliveryAddress._id }, paymentMethod: paymentMethod,
        status: "PENDING", tipping: finalTipping, taxAmount: parseFloat(taxAmount.toFixed(2)),
        deliveryCharges: parseFloat(deliveryCharges.toFixed(2)), subTotal: parseFloat(subTotal.toFixed(2)),
        totalAmount: parseFloat(totalAmount.toFixed(2)), notes: notes || null, orderDate: now.toISOString(),
        expectedDeliveryTime: null, preparationTimeMinutes: preparationTimeMinutes || 30,
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
        confirmedAt: null, preparingAt: null, readyForPickupAt: null, pickedUpAt: null,
        deliveredAt: null, cancelledAt: null, rejectedAt: null,
        paymentStatus: paymentStatus, mockPaymentTransactionId: mockTransactionId,
        deliveryIdImageUrl: null, deliveryVerificationTimestamp: null,
        deliveryRecipientNameMatchesId: null, deliveryRecipientIsOfLegalAge: null,
      };
      await db.collection(ORDERS_COLLECTION).insertOne(newOrder);
      return transformOrder(db, newOrder);
    },
    updateOrderStatus: async (_, { orderId, status }, context) => { /* ... existing ... */
      if (!context.user || !context.user.id) throw new AuthenticationError('Not authenticated.');
      const db = getDB();
      let orderToUpdate; let orderObjectId;
      if (ObjectId.isValid(orderId)) { orderObjectId = new ObjectId(orderId); orderToUpdate = await db.collection(ORDERS_COLLECTION).findOne({ _id: orderObjectId }); }
      if (!orderToUpdate) { orderToUpdate = await db.collection(ORDERS_COLLECTION).findOne({ orderId: orderId }); if (orderToUpdate) orderObjectId = orderToUpdate._id; }
      if (!orderToUpdate) throw new UserInputError('Order not found.');
      if (!orderToUpdate.userId.equals(new ObjectId(context.user.id))) {
          console.warn(`User ${context.user.id} trying to update order ${orderToUpdate.orderId} owned by ${orderToUpdate.userId}. Allowed for testing.`);
      }
      const updates = { status: status, updatedAt: new Date() };
      const nowISO = new Date().toISOString();
      switch (status) {
        case "CONFIRMED": updates.confirmedAt = nowISO; break;
        case "PREPARING": updates.preparingAt = nowISO; break;
        case "READY_FOR_PICKUP": updates.readyForPickupAt = nowISO; break;
        case "PICKED_UP": updates.pickedUpAt = nowISO; break;
        case "DELIVERED": updates.deliveredAt = nowISO; break;
        case "CANCELLED": updates.cancelledAt = nowISO; break;
        case "REJECTED": updates.rejectedAt = nowISO; break;
      }
      await db.collection(ORDERS_COLLECTION).updateOne({ _id: orderObjectId }, { $set: updates });
      const updatedOrderDoc = await db.collection(ORDERS_COLLECTION).findOne({ _id: orderObjectId });
      const transformedUpdatedOrder = await transformOrder(db, updatedOrderDoc);
      pubsub.publish(`${ORDER_STATUS_CHANGED_TOPIC}_${orderObjectId.toHexString()}`, { orderStatusChanged: transformedUpdatedOrder });
      pubsub.publish(`${ORDER_STATUS_CHANGED_TOPIC}_USER_${orderToUpdate.userId.toHexString()}`, { orderStatusChanged: transformedUpdatedOrder });
      return transformedUpdatedOrder;
    },
    uploadIdImage: async (_, { imageUrl }, context) => { /* ... existing ... */
      if (!context.user || !context.user.id) {
        throw new AuthenticationError('You must be logged in to upload an ID image.');
      }
      const db = getDB();
      const userIdObj = new ObjectId(context.user.id);
      const updates = {
        idImageUrl: imageUrl, idVerificationStatus: "PENDING_VERIFICATION",
        idRejectionReason: null, updatedAt: new Date(),
      };
      const result = await db.collection(USERS_COLLECTION).updateOne({ _id: userIdObj }, { $set: updates });
      if (result.matchedCount === 0) {
        throw new ApolloError('User not found, could not update ID image.', 'USER_NOT_FOUND');
      }
      return findUserAndTransform(db, userIdObj);
    },
    _admin_updateIdVerificationStatus: async (_, { userId, status, dateOfBirth, rejectionReason }, context) => { /* ... existing ... */
      if (!context.user || !context.user.id) {
        throw new AuthenticationError('Admin action: Not authenticated.');
      }
      console.log(`Admin action by ${context.user.id}: Updating ID verification for user ${userId} to ${status}`);
      const db = getDB();
      const targetUserIdObj = new ObjectId(userId);
      const updates = { idVerificationStatus: status, updatedAt: new Date() };
      if (status === "VERIFIED") {
        if (!dateOfBirth) throw new UserInputError('Date of birth is required for VERIFIED status.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) throw new UserInputError('Invalid date of birth format. Expected YYYY-MM-DD.');
        updates.dateOfBirth = dateOfBirth;
        updates.idRejectionReason = null;
      } else if (status === "REJECTED") {
        if (!rejectionReason || rejectionReason.trim() === "") throw new UserInputError('Rejection reason is required for REJECTED status.');
        updates.idRejectionReason = rejectionReason;
      } else if (status === "NOT_UPLOADED" || status === "PENDING_VERIFICATION") {
        updates.idRejectionReason = null;
      }
      const result = await db.collection(USERS_COLLECTION).updateOne({ _id: targetUserIdObj }, { $set: updates });
      if (result.matchedCount === 0) throw new ApolloError(`User with ID ${userId} not found.`, 'USER_NOT_FOUND');
      return findUserAndTransform(db, targetUserIdObj);
    },
    confirmDeliveryWithId: async (_, { orderId, deliveryIdImageUrl, recipientNameMatchesId, recipientIsOfLegalAge }, context) => { /* ... existing ... */
      if (!context.user || !context.user.id) {
        throw new AuthenticationError('You must be logged in to confirm delivery.');
      }
      console.log(`Delivery confirmation attempt by user ${context.user.id} for order ${orderId}`);
      const db = getDB();
      let orderToUpdate; let orderObjectId;
      if (ObjectId.isValid(orderId)) { orderObjectId = new ObjectId(orderId); orderToUpdate = await db.collection(ORDERS_COLLECTION).findOne({ _id: orderObjectId }); }
      if (!orderToUpdate && !ObjectId.isValid(orderId)) { orderToUpdate = await db.collection(ORDERS_COLLECTION).findOne({ orderId: orderId }); if (orderToUpdate) orderObjectId = orderToUpdate._id; }
      if (!orderToUpdate) { throw new UserInputError('Order not found.'); }
      const updates = {
        deliveryIdImageUrl: deliveryIdImageUrl, deliveryVerificationTimestamp: new Date().toISOString(),
        deliveryRecipientNameMatchesId: recipientNameMatchesId, deliveryRecipientIsOfLegalAge: recipientIsOfLegalAge,
        updatedAt: new Date(),
      };
      let publishUpdate = false;
      if (recipientNameMatchesId && recipientIsOfLegalAge) {
        updates.status = "DELIVERED"; updates.deliveredAt = new Date().toISOString(); publishUpdate = true;
        console.log(`Order ${orderToUpdate.orderId} delivery verified and status set to DELIVERED.`);
      } else {
        console.warn(`Order ${orderToUpdate.orderId} delivery ID verification failed. Name Match: ${recipientNameMatchesId}, Legal Age: ${recipientIsOfLegalAge}. Order status NOT changed to DELIVERED.`);
      }
      await db.collection(ORDERS_COLLECTION).updateOne({ _id: orderObjectId }, { $set: updates });
      const updatedOrderDoc = await db.collection(ORDERS_COLLECTION).findOne({ _id: orderObjectId });
      const transformedUpdatedOrder = await transformOrder(db, updatedOrderDoc);
      if (publishUpdate) {
        pubsub.publish(`${ORDER_STATUS_CHANGED_TOPIC}_${orderObjectId.toHexString()}`, { orderStatusChanged: transformedUpdatedOrder });
        pubsub.publish(`${ORDER_STATUS_CHANGED_TOPIC}_USER_${orderToUpdate.userId.toHexString()}`, { orderStatusChanged: transformedUpdatedOrder });
      }
      return transformedUpdatedOrder;
    },

    // New Review Mutation
    submitReview: async (_, { input }, context) => {
      if (!context.user || !context.user.id) {
        throw new AuthenticationError('You must be logged in to submit a review.');
      }
      const db = getDB();
      const userIdObj = new ObjectId(context.user.id);
      const targetIdObj = new ObjectId(input.targetId);

      if (input.rating < 1 || input.rating > 5) {
        throw new UserInputError('Rating must be between 1 and 5.');
      }

      // Check if target exists
      const targetCollection = input.targetType === "STORE" ? STORES_COLLECTION : PRODUCTS_COLLECTION;
      const targetExists = await db.collection(targetCollection).findOne({ _id: targetIdObj });
      if (!targetExists) {
        throw new UserInputError(`${input.targetType} with ID ${input.targetId} not found.`);
      }
      
      // Check for existing review by this user for this target
      const existingReview = await db.collection(REVIEWS_COLLECTION).findOne({
        userId: userIdObj,
        targetId: targetIdObj,
        targetType: input.targetType,
      });

      let savedReview;
      const now = new Date();

      if (existingReview) {
        // Update existing review
        const updateResult = await db.collection(REVIEWS_COLLECTION).findOneAndUpdate(
          { _id: existingReview._id },
          { $set: { 
              rating: input.rating, 
              comment: input.comment || null, 
              updatedAt: now 
            } 
          },
          { returnDocument: 'after' }
        );
        savedReview = updateResult.value;
      } else {
        // Create new review
        const newReview = {
          _id: new ObjectId(),
          userId: userIdObj,
          targetType: input.targetType,
          targetId: targetIdObj,
          rating: input.rating,
          comment: input.comment || null,
          createdAt: now,
          updatedAt: now,
        };
        const insertResult = await db.collection(REVIEWS_COLLECTION).insertOne(newReview);
        // insertOne doesn't return the document directly in all driver versions in the same way,
        // so we use the newReview object which already has the _id.
        savedReview = newReview; 
      }

      // Trigger update of aggregates (can be awaited or run in background)
      await updateTargetReviewAggregates(db, input.targetId, input.targetType);
      
      return transformReview(db, savedReview);
    },
  },
  Subscription: { /* ... existing ... */
    orderStatusChanged: {
      subscribe: async (_, { orderId }, context) => {
        if (!context.user || !context.user.id) throw new AuthenticationError('Not authenticated for subscription.');
        const db = getDB();
        let orderObjectId; let orderToSubscribe;
        if (ObjectId.isValid(orderId)) { orderObjectId = new ObjectId(orderId); orderToSubscribe = await db.collection(ORDERS_COLLECTION).findOne({ _id: orderObjectId }); }
        if(!orderToSubscribe) { orderToSubscribe = await db.collection(ORDERS_COLLECTION).findOne({ orderId: orderId }); if (orderToSubscribe) orderObjectId = orderToSubscribe._id; }
        if (!orderToSubscribe) throw new UserInputError('Order not found for subscription.');
        if (!orderToSubscribe.userId.equals(new ObjectId(context.user.id))) throw new AuthenticationError('Not authorized to subscribe to this order.');
        return pubsub.asyncIterator(`${ORDER_STATUS_CHANGED_TOPIC}_${orderObjectId.toHexString()}`);
      },
    },
  },
  // New Field Resolvers for Store and Product
  Store: {
    reviews: async (parent, { offset = 0, limit = 10 }, { db }) => {
      const reviews = await db.collection(REVIEWS_COLLECTION)
        .find({ targetId: new ObjectId(parent._id), targetType: "STORE" })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();
      return Promise.all(reviews.map(review => transformReview(db, review)));
    },
    // averageRating and reviewCount are directly transformed from the parent document
    averageRating: (parent) => parent.averageRating || 0.0,
    reviewCount: (parent) => parent.reviewCount || 0,
  },
  Product: {
    reviews: async (parent, { offset = 0, limit = 10 }, { db }) => {
      const reviews = await db.collection(REVIEWS_COLLECTION)
        .find({ targetId: new ObjectId(parent._id), targetType: "PRODUCT" })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();
      return Promise.all(reviews.map(review => transformReview(db, review)));
    },
    averageRating: (parent) => parent.averageRating || 0.0,
    reviewCount: (parent) => parent.reviewCount || 0,
  },
  Review: { // Ensure User field in Review is resolved if not already handled by transformReview
      user: async (parent, _, { db }) => {
          if (parent.user && parent.user.id && parent.user.name) return parent.user; // Already populated by transformReview
          return findUserAndTransform(db, new ObjectId(parent.userId));
      }
  }
};

module.exports = resolvers;
