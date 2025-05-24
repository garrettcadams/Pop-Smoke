const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { AuthenticationError, UserInputError, ApolloError } = require('apollo-server-express');
const { PubSub } = require('graphql-subscriptions'); // For Subscriptions
const { getDB } = require('../db');
const { JWT_SECRET, ...config } = require('../config'); // Import the centralized config, exclude JWT_SECRET if already destructured
const { ObjectId } = require('mongodb');
const slugify = require('../utils/slugify');

const pubsub = new PubSub(); // Instantiate PubSub
const ORDER_STATUS_CHANGED_TOPIC = 'ORDER_STATUS_CHANGED'; // Topic for publishing

const USERS_COLLECTION = 'users';
const RESTAURANTS_COLLECTION = 'restaurants';
const CATEGORIES_COLLECTION = 'categories';
const FOODITEMS_COLLECTION = 'fooditems';
const ORDERS_COLLECTION = 'orders';

// --- Helper Functions for Output Transformation ---
const transformAddonOption = (option) => {
  if (!option) return null;
  return { ...option, _id: (option._id || new ObjectId()).toHexString() };
};

const transformAddon = (addon) => {
  if (!addon) return null;
  return {
    ...addon,
    _id: (addon._id || new ObjectId()).toHexString(),
    options: addon.options ? addon.options.map(transformAddonOption) : [],
  };
};

const transformVariation = (variation) => {
  if (!variation) return null;
  return {
    ...variation,
    _id: (variation._id || new ObjectId()).toHexString(),
    addons: variation.addons ? variation.addons.map(transformAddon) : [],
  };
};

const transformFoodItem = (foodItem, isSnapshot = false) => {
  if (!foodItem) return null;
  const id = foodItem._id ? foodItem._id.toHexString() : (isSnapshot ? null : new ObjectId().toHexString());
  return {
    ...foodItem, _id: id, title: foodItem.title || "N/A", image: foodItem.image || null,
    description: foodItem.description || null,
    variations: foodItem.variations ? foodItem.variations.map(v => transformVariation(v)) : [],
    isAvailable: foodItem.isAvailable !== undefined ? foodItem.isAvailable : true,
    categoryId: foodItem.categoryId ? (typeof foodItem.categoryId === 'string' ? foodItem.categoryId : foodItem.categoryId.toHexString()) : null,
    restaurantId: foodItem.restaurantId ? (typeof foodItem.restaurantId === 'string' ? foodItem.restaurantId : foodItem.restaurantId.toHexString()) : null,
  };
};

const transformCategory = async (db, category) => {
  if (!category) return null;
  let foods = [];
  if (category.foodItemIds && category.foodItemIds.length > 0) {
     const foodObjectIds = category.foodItemIds.map(id => new ObjectId(id));
     foods = await db.collection(FOODITEMS_COLLECTION).find({ _id: { $in: foodObjectIds } }).toArray();
     foods = foods.map(fi => transformFoodItem(fi));
  } else {
    foods = category.foods ? category.foods.map(fi => transformFoodItem(fi)) : [];
  }
  return {
    ...category, _id: category._id.toHexString(), foods: foods,
    restaurantId: category.restaurantId ? (typeof category.restaurantId === 'string' ? category.restaurantId : category.restaurantId.toHexString()) : null,
  };
};

const transformRestaurant = async (db, restaurant, isSnapshot = false) => {
  if (!restaurant) return null;
  const id = restaurant._id ? restaurant._id.toHexString() : (isSnapshot ? null : new ObjectId().toHexString());
  let categories = [];
  if (!isSnapshot && restaurant.categoryIds && restaurant.categoryIds.length > 0) {
    const categoryObjectIds = restaurant.categoryIds.map(catId => new ObjectId(catId));
    const fetchedCategories = await db.collection(CATEGORIES_COLLECTION).find({ _id: { $in: categoryObjectIds } }).toArray();
    categories = await Promise.all(fetchedCategories.map(cat => transformCategory(db, cat)));
  } else if (restaurant.categories) {
    categories = await Promise.all(restaurant.categories.map(cat => transformCategory(db, cat)));
  }
  return {
    ...restaurant, _id: id, name: restaurant.name || "N/A", image: restaurant.image || null,
    slug: restaurant.slug || (restaurant.name ? slugify(restaurant.name) : null),
    address: restaurant.address || "N/A", location: restaurant.location,
    reviewData: restaurant.reviewData || { total: 0, ratings: 0.0 },
    rating: restaurant.rating || (restaurant.reviewData ? restaurant.reviewData.ratings : 0.0),
    zone: restaurant.zone || null, categories: categories, openingTimes: restaurant.openingTimes || [],
  };
};

const transformAddressOutput = (address, isSnapshot = false) => {
  if (!address) return null;
  const id = address._id ? address._id.toHexString() : (isSnapshot ? null : new ObjectId().toHexString());
  return { 
    ...address, _id: id, label: address.label || null, deliveryAddress: address.deliveryAddress || "N/A",
    details: address.details || null, location: address.location,
    selected: address.selected !== undefined ? address.selected : null,
  };
};

const findUserAndTransform = async (db, userId) => {
  const user = await db.collection(USERS_COLLECTION).findOne({ _id: userId });
  if (!user) return null;
  return {
    ...user, _id: user._id.toHexString(), id: user._id.toHexString(),
    name: user.name || "N/A", email: user.email || "N/A", phone: user.phone || null,
    addresses: user.addresses && user.addresses.length > 0 ? user.addresses.map(addr => transformAddressOutput(addr)) : [],
  };
};

const transformOrderItem = async (db, orderItem) => {
  return {
    ...orderItem, _id: orderItem._id.toHexString(),
    foodItemSnapshot: transformFoodItem(orderItem.foodItemSnapshot, true),
    variationSnapshot: transformVariation(orderItem.variationSnapshot),
    selectedAddons: orderItem.selectedAddons.map(sa => ({ ...sa })),
  };
};

const transformOrder = async (db, order) => {
  if (!order) return null;
  const items = await Promise.all(order.items.map(item => transformOrderItem(db, item)));
  const user = await findUserAndTransform(db, new ObjectId(order.userId));
  const restaurant = await transformRestaurant(db, order.restaurantSnapshot, true);
  return {
    ...order, _id: order._id.toHexString(), user: user || { id: order.userId.toHexString(), name: "User not found" },
    restaurant: restaurant || { _id: order.restaurantId.toHexString(), name: "Restaurant not found" },
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
    // Include new payment fields, providing defaults if they might be missing from older documents
    paymentStatus: order.paymentStatus || "PENDING", // Default to PENDING if not set
    mockPaymentTransactionId: order.mockPaymentTransactionId || null,
  };
};

// --- Resolvers ---
const resolvers = {
  Query: {
    getConfiguration: () => {
        return {
            _id: "global_configuration", currency: config.APP_CURRENCY, currencySymbol: config.APP_CURRENCY_SYMBOL,
            deliveryRatePerKm: config.DELIVERY_RATE_PER_KM, maxDeliveryDistanceKm: config.MAX_DELIVERY_DISTANCE_KM,
            googleApiKey: config.GOOGLE_API_KEY_CLIENT, stripePublishableKey: config.STRIPE_PUBLISHABLE_KEY_CLIENT,
            twilioEnabled: config.TWILIO_ENABLED, skipEmailVerification: config.SKIP_EMAIL_VERIFICATION,
            skipMobileVerification: config.SKIP_MOBILE_VERIFICATION, appMinimumVersion: config.APP_MINIMUM_VERSION,
        };
    },
    health: () => 'Server is up and running!',
    userProfile: async (_, __, context) => {
      if (!context.user || !context.user.id) throw new AuthenticationError('Not authenticated.');
      const db = getDB();
      return findUserAndTransform(db, new ObjectId(context.user.id));
    },
    nearByRestaurants: async (_, { latitude, longitude, radius }) => {
      const db = getDB();
      const searchRadiusMeters = (radius || 5.0) * 1000;
      const restaurants = await db.collection(RESTAURANTS_COLLECTION).find({
        location: { $nearSphere: { $geometry: { type: "Point", coordinates: [longitude, latitude] }, $maxDistance: searchRadiusMeters } }
      }).toArray();
      return Promise.all(restaurants.map(r => transformRestaurant(db, r)));
    },
    restaurant: async (_, { id, slug }) => {
      if (!id && !slug) throw new UserInputError("Either ID or slug must be provided.");
      const db = getDB();
      const query = id ? { _id: new ObjectId(id) } : { slug: slug };
      const restaurantDoc = await db.collection(RESTAURANTS_COLLECTION).findOne(query);
      if (!restaurantDoc) return null;
      return transformRestaurant(db, restaurantDoc);
    },
    myOrders: async (_, { offset = 0, limit = 10 }, context) => {
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
    orderDetails: async (_, { orderId }, context) => {
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
  },
  Mutation: {
    register: async (_, { name, email, password, phone }) => { 
      const db = getDB();
      const existingUser = await db.collection(USERS_COLLECTION).findOne({ email });
      if (existingUser) throw new UserInputError('Email already in use.');
      if (password.length < 6) throw new UserInputError('Password too short.');
      const hashedPassword = await bcrypt.hash(password, 12);
      const newUserDoc = {
        _id: new ObjectId(), name, email, password: hashedPassword, phone: phone || null,
        emailIsVerified: false, phoneIsVerified: false, addresses: [], createdAt: new Date(), updatedAt: new Date(),
      };
      await db.collection(USERS_COLLECTION).insertOne(newUserDoc);
      const token = jwt.sign({ id: newUserDoc._id.toHexString(), email: newUserDoc.email }, JWT_SECRET, { expiresIn: '1h' });
      return { token, userId: newUserDoc._id.toHexString(), name: newUserDoc.name, email: newUserDoc.email };
    },
    login: async (_, { email, password }) => { 
        const db = getDB();
        const user = await db.collection(USERS_COLLECTION).findOne({ email });
        if (!user) throw new AuthenticationError('Invalid credentials.');
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) throw new AuthenticationError('Invalid credentials.');
        const token = jwt.sign({ id: user._id.toHexString(), email: user.email }, JWT_SECRET, { expiresIn: '1h' });
        return { token, userId: user._id.toHexString(), name: user.name, email: user.email };
    },
    updateUserProfile: async (_, { name, phone }, context) => { 
        if (!context.user) throw new AuthenticationError('Not authenticated.');
        const db = getDB();
        const userIdObj = new ObjectId(context.user.id);
        const updates = {updatedAt: new Date()};
        if (name !== undefined) updates.name = name;
        if (phone !== undefined) { updates.phone = phone; updates.phoneIsVerified = false; }
        if (Object.keys(updates).length <= 1) throw new UserInputError('No updates provided.');
        await db.collection(USERS_COLLECTION).updateOne({ _id: userIdObj }, { $set: updates });
        return findUserAndTransform(db, userIdObj);
    },
    sendOtpToEmail: async (_, { email }) => { console.log(`OTP for email ${email} (simulated)`); return true; },
    verifyEmailOtp: async (_, { email, otp }) => { 
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
    verifyPhoneOtp: async (_, { otp }, context) => { 
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
    createAddress: async (_, { addressInput }, context) => {
        if (!context.user) throw new AuthenticationError('Not authenticated.');
        const db = getDB();
        const userIdObj = new ObjectId(context.user.id);
        const user = await db.collection(USERS_COLLECTION).findOne({ _id: userIdObj }); 
        if (!user) throw new AuthenticationError('User not found.');
        const newAddress = {
            _id: new ObjectId(), label: addressInput.label, deliveryAddress: addressInput.deliveryAddress,
            details: addressInput.details, location: { type: addressInput.location.type || "Point", coordinates: addressInput.location.coordinates },
            selected: !user.addresses || user.addresses.length === 0,
        };
        await db.collection(USERS_COLLECTION).updateOne({ _id: userIdObj }, { $push: { addresses: newAddress }, $set: {updatedAt: new Date()} });
        if (newAddress.selected && user.addresses && user.addresses.length > 0) {
            await db.collection(USERS_COLLECTION).updateOne(
              { _id: userIdObj, "addresses._id": { $ne: newAddress._id } },
              { $set: { "addresses.$[elem].selected": false } },
              { arrayFilters: [{ "elem.selected": true }] }
            );
        }
        return findUserAndTransform(db, userIdObj);
    },
    updateAddress: async (_, { addressId, addressInput }, context) => {
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
    deleteAddress: async (_, { addressId }, context) => {
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
    selectAddress: async (_, { addressId }, context) => {
        if (!context.user) throw new AuthenticationError('Not authenticated.');
        const db = getDB();
        const userIdObj = new ObjectId(context.user.id);
        const addressIdObj = new ObjectId(addressId);
        await db.collection(USERS_COLLECTION).updateOne({ _id: userIdObj }, { $set: { "addresses.$[].selected": false, updatedAt: new Date() } });
        await db.collection(USERS_COLLECTION).updateOne({ _id: userIdObj, "addresses._id": addressIdObj }, { $set: { "addresses.$.selected": true } });
        return findUserAndTransform(db, userIdObj);
    },
    _ensureRestaurantIndex: async () => { console.log("Index check reminder."); return true; },
    createRestaurant: async (_, { input }) => {
        const db = getDB();
        const newRestaurantDoc = { 
            _id: new ObjectId(), name: input.name, image: input.image || null, slug: input.slug || slugify(input.name),
            address: input.address, location: { type: "Point", coordinates: input.location.coordinates },
            deliveryTime: input.deliveryTime || null, minimumOrder: input.minimumOrder || 0, tax: input.tax || 0,
            openingTimes: input.openingTimes ? input.openingTimes.map(ot => ({ day: ot.day, times: ot.times ? ot.times.map(ts => ({ startTime: ts.startTime, endTime: ts.endTime })) : [] })) : [],
            isAvailable: input.isAvailable !== undefined ? input.isAvailable : true, categoryIds: [],
            reviewData: { total: 0, ratings: 0.0 }, rating: 0.0, createdAt: new Date(), updatedAt: new Date(),
        };
        await db.collection(RESTAURANTS_COLLECTION).insertOne(newRestaurantDoc);
        return transformRestaurant(db, newRestaurantDoc);
    },
    updateRestaurant: async (_, { id, input }) => {
        const db = getDB();
        const restaurantIdObj = new ObjectId(id);
        const updates = { updatedAt: new Date() };
        if (input.name) { updates.name = input.name; updates.slug = input.slug || slugify(input.name); }
        if (input.slug) updates.slug = input.slug;
        if (input.image !== undefined) updates.image = input.image;
        if (input.address) updates.address = input.address;
        if (input.location) updates.location = { type: "Point", coordinates: input.location.coordinates };
        if (input.deliveryTime !== undefined) updates.deliveryTime = input.deliveryTime;
        if (input.minimumOrder !== undefined) updates.minimumOrder = input.minimumOrder;
        if (input.tax !== undefined) updates.tax = input.tax;
        if (input.openingTimes) updates.openingTimes = input.openingTimes.map(ot => ({ day: ot.day, times: ot.times ? ot.times.map(ts => ({startTime: ts.startTime, endTime: ts.endTime})) : [] }));
        if (input.isAvailable !== undefined) updates.isAvailable = input.isAvailable;
        await db.collection(RESTAURANTS_COLLECTION).updateOne({ _id: restaurantIdObj }, { $set: updates });
        const updatedDoc = await db.collection(RESTAURANTS_COLLECTION).findOne({ _id: restaurantIdObj });
        return transformRestaurant(db, updatedDoc);
    },
    createCategory: async (_, { input }) => {
        const db = getDB();
        const restaurantIdObj = new ObjectId(input.restaurantId);
        const restaurant = await db.collection(RESTAURANTS_COLLECTION).findOne({ _id: restaurantIdObj });
        if (!restaurant) throw new UserInputError("Restaurant not found for this category.");
        const newCategoryDoc = {
            _id: new ObjectId(), title: input.title, restaurantId: restaurantIdObj, foodItemIds: [],
            createdAt: new Date(), updatedAt: new Date(),
        };
        await db.collection(CATEGORIES_COLLECTION).insertOne(newCategoryDoc);
        await db.collection(RESTAURANTS_COLLECTION).updateOne({ _id: restaurantIdObj }, { $addToSet: { categoryIds: newCategoryDoc._id }, $currentDate: {updatedAt: true} });
        return transformCategory(db, newCategoryDoc);
    },
    updateCategory: async (_, { id, input }) => {
        const db = getDB();
        const categoryIdObj = new ObjectId(id);
        const updates = { updatedAt: new Date() };
        if (input.title) updates.title = input.title;
        await db.collection(CATEGORIES_COLLECTION).updateOne({ _id: categoryIdObj }, { $set: updates });
        const updatedDoc = await db.collection(CATEGORIES_COLLECTION).findOne({ _id: categoryIdObj });
        return transformCategory(db, updatedDoc);
    },
    createFoodItem: async (_, { input }) => {
        const db = getDB();
        const categoryIdObj = new ObjectId(input.categoryId);
        const restaurantIdObj = new ObjectId(input.restaurantId);
        const category = await db.collection(CATEGORIES_COLLECTION).findOne({ _id: categoryIdObj, restaurantId: restaurantIdObj });
        if (!category) throw new UserInputError("Category not found or not associated with the given restaurant.");
        const newFoodItemDoc = {
            _id: new ObjectId(), title: input.title, image: input.image || null, description: input.description || null,
            variations: input.variations ? input.variations.map(v => ({ _id: new ObjectId(), title: v.title, price: v.price, discounted: v.discounted || null, addons: v.addons ? v.addons.map(a => ({ _id: new ObjectId(), title: a.title, description: a.description || null, options: a.options ? a.options.map(o => ({ _id: new ObjectId(), title: o.title, description: o.description || null, price: o.price })) : [], quantityMinimum: a.quantityMinimum, quantityMaximum: a.quantityMaximum })) : [] })) : [],
            categoryId: categoryIdObj, restaurantId: restaurantIdObj,
            isAvailable: input.isAvailable !== undefined ? input.isAvailable : true,
            createdAt: new Date(), updatedAt: new Date(),
        };
        await db.collection(FOODITEMS_COLLECTION).insertOne(newFoodItemDoc);
        await db.collection(CATEGORIES_COLLECTION).updateOne({ _id: categoryIdObj }, { $addToSet: { foodItemIds: newFoodItemDoc._id }, $currentDate: {updatedAt: true} });
        return transformFoodItem(newFoodItemDoc);
    },
    updateFoodItem: async (_, { id, input }) => {
        const db = getDB();
        const foodItemIdObj = new ObjectId(id);
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
        await db.collection(FOODITEMS_COLLECTION).updateOne({ _id: foodItemIdObj }, { $set: updates });
        const updatedDoc = await db.collection(FOODITEMS_COLLECTION).findOne({ _id: foodItemIdObj });
        return transformFoodItem(updatedDoc);
    },
    placeOrder: async (_, { restaurantId, items, paymentMethod, addressId, tipping, notes, preparationTimeMinutes }, context) => {
      if (!context.user || !context.user.id) throw new AuthenticationError('Not authenticated.');
      const db = getDB();
      const userIdObj = new ObjectId(context.user.id);
      const user = await db.collection(USERS_COLLECTION).findOne({ _id: userIdObj });
      if (!user) throw new AuthenticationError('User not found.');
      const deliveryAddress = user.addresses.find(addr => addr._id.equals(new ObjectId(addressId)));
      if (!deliveryAddress) throw new UserInputError('Delivery address not found for user.');
      const restaurantObjId = new ObjectId(restaurantId);
      const restaurant = await db.collection(RESTAURANTS_COLLECTION).findOne({ _id: restaurantObjId });
      if (!restaurant || !restaurant.isAvailable) throw new UserInputError('Restaurant not found or is currently unavailable.');
      let subTotal = 0;
      const orderItems = [];
      for (const itemInput of items) {
        const foodItemObjId = new ObjectId(itemInput.foodItemId);
        const foodItem = await db.collection(FOODITEMS_COLLECTION).findOne({ _id: foodItemObjId, restaurantId: restaurantObjId });
        if (!foodItem || !foodItem.isAvailable) throw new UserInputError(`Food item ${itemInput.foodItemId} not found or unavailable.`);
        const variation = foodItem.variations.find(v => v._id.equals(new ObjectId(itemInput.variationId)));
        if (!variation) throw new UserInputError(`Variation ${itemInput.variationId} not found for food item ${itemInput.foodItemId}.`);
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
        const foodItemSnapshot = { _id: foodItem._id, title: foodItem.title, image: foodItem.image };
        const variationSnapshot = { _id: variation._id, title: variation.title, price: variation.price, discounted: variation.discounted };
        orderItems.push({
          _id: new ObjectId(), foodItemId: foodItem._id, foodItemSnapshot: foodItemSnapshot,
          variationId: variation._id, variationSnapshot: variationSnapshot, quantity: itemInput.quantity,
          selectedAddons: selectedAddonsSnapshots, unitPrice: currentItemUnitPrice,
          totalItemPrice: currentItemUnitPrice * itemInput.quantity,
        });
        subTotal += currentItemUnitPrice * itemInput.quantity;
      }
      const restaurantTaxRate = restaurant.tax || 0;
      const taxAmount = subTotal * (restaurantTaxRate / 100);
      const deliveryCharges = 5.0; // Placeholder
      const finalTipping = tipping || 0;
      const totalAmount = subTotal + taxAmount + deliveryCharges + finalTipping;
      const now = new Date();

      // Simulate Payment Processing
      console.log(`Simulating payment processing for paymentMethod: ${paymentMethod}`);
      const mockTransactionId = `MOCK_TXN_${new ObjectId().toHexString()}`;
      const paymentStatus = "SUCCESSFUL"; // Assume success for mock

      const newOrder = {
        _id: new ObjectId(), orderId: `ORD-${now.getTime().toString().slice(-6)}-${String(Math.floor(Math.random()*1000)).padStart(3,'0')}`,
        userId: userIdObj, restaurantId: restaurantObjId,
        restaurantSnapshot: { _id: restaurant._id, name: restaurant.name, image: restaurant.image, address: restaurant.address },
        items: orderItems, deliveryAddress: { ...deliveryAddress, _id: deliveryAddress._id }, paymentMethod: paymentMethod,
        status: "PENDING", // Order status remains PENDING until restaurant confirms
        tipping: finalTipping, taxAmount: parseFloat(taxAmount.toFixed(2)),
        deliveryCharges: parseFloat(deliveryCharges.toFixed(2)), subTotal: parseFloat(subTotal.toFixed(2)),
        totalAmount: parseFloat(totalAmount.toFixed(2)), notes: notes || null, orderDate: now.toISOString(),
        expectedDeliveryTime: null, preparationTimeMinutes: preparationTimeMinutes || 30,
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
        confirmedAt: null, preparingAt: null, readyForPickupAt: null, pickedUpAt: null,
        deliveredAt: null, cancelledAt: null, rejectedAt: null,
        // Add new payment fields
        paymentStatus: paymentStatus,
        mockPaymentTransactionId: mockTransactionId,
      };
      await db.collection(ORDERS_COLLECTION).insertOne(newOrder);
      return transformOrder(db, newOrder);
    },
    updateOrderStatus: async (_, { orderId, status }, context) => {
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
  },
  Subscription: {
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
};

module.exports = resolvers;
