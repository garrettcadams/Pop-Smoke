const { gql } = require('apollo-server-express');

const typeDefs = gql`
  type Query {
    health: String
    userProfile: User # Requires authentication
    nearByRestaurants(latitude: Float!, longitude: Float!, radius: Float = 5.0): [Restaurant!]
    restaurant(id: ID, slug: String): Restaurant
    myOrders(offset: Int, limit: Int): [Order!] # For logged-in user
    orderDetails(orderId: ID!): Order # For logged-in user or admin (by MongoDB _id or custom orderId string)
    getConfiguration: Configuration
  }

  type Configuration {
    _id: ID! # Typically a single global config document
    currency: String!
    currencySymbol: String!
    deliveryRatePerKm: Float
    maxDeliveryDistanceKm: Float
    googleApiKey: String # For maps on frontend
    stripePublishableKey: String # Example payment gateway key
    twilioEnabled: Boolean
    skipEmailVerification: Boolean
    skipMobileVerification: Boolean
    appMinimumVersion: String
  }

  type Subscription {
    orderStatusChanged(orderId: ID!): Order
  }

  type User {
    id: ID!
    name: String!
    email: String!
    phone: String
    emailIsVerified: Boolean
    phoneIsVerified: Boolean
    addresses: [Address!]
  }

  type Restaurant {
    _id: ID!
    name: String!
    image: String
    slug: String!
    address: String! # Full address string
    location: Location! # GeoJSON Point
    deliveryTime: String # e.g., "30-45 mins"
    minimumOrder: Float
    tax: Float # Restaurant-specific tax, if any
    reviewData: ReviewSummary # Aggregated review data
    categories: [Category!] # Menu categories
    rating: Float # Overall restaurant rating, could be same as reviewData.ratings
    isAvailable: Boolean # Is the restaurant currently open/taking orders
    openingTimes: [OpeningTimeEntry!]
    zone: Zone # Delivery zone information
  }

  type OpeningTimeEntry {
    day: String! # e.g., "Monday", "Tuesday"
    times: [TimeSlot!]
  }

  type TimeSlot {
    startTime: String! # e.g., "10:00"
    endTime: String! # e.g., "22:00"
  }

  type ReviewSummary {
    total: Int! # Total number of reviews
    ratings: Float # Average rating
  }
  
  type Zone {
    _id: ID
    title: String
    tax: Float # Zone specific tax that might override/add to restaurant tax
  }

  type Category {
    _id: ID!
    title: String!
    foods: [FoodItem!]
    restaurantId: ID # Reference to the restaurant this category belongs to
  }

  type FoodItem {
    _id: ID!
    title: String!
    image: String
    description: String
    variations: [Variation!]
    isAvailable: Boolean # Default true
    categoryId: ID # Reference to the category this food item belongs to
    restaurantId: ID # Reference to the restaurant this food item belongs to
  }

  type Variation {
    _id: ID! # Can be an ObjectId if stored separately, or a simple unique ID if embedded
    title: String! # e.g., "Small", "Large", "Spicy"
    price: Float!
    discounted: Float # Optional discounted price
    addons: [Addon!] # Could also be [ID!] if addons are separate global entities
  }

  # Addon can be specific to a FoodItem/Variation or globally defined and linked
  type Addon {
    _id: ID!
    title: String! # e.g., "Extra Cheese", "Toppings"
    description: String
    options: [AddonOption!]!
    quantityMinimum: Int! # e.g., 0 for optional, 1 for required
    quantityMaximum: Int! # e.g., 1 for single choice, N for multiple choices
  }

  type AddonOption {
    _id: ID! # Can be an ObjectId or unique ID if embedded
    title: String! # e.g., "Mozzarella", "Pepperoni"
    description: String
    price: Float! # Price for this specific option
  }

  type Address {
    _id: ID!
    label: String
    deliveryAddress: String!
    details: String
    location: Location
    selected: Boolean
  }

  # --- Order Related Types ---
  input OrderItemAddonInput {
    addonId: ID! # Refers to the _id of the Addon object within FoodItem.variations.addons
    selectedOptionId: ID! # Refers to the _id of the AddonOption within that Addon
  }

  input OrderItemInput {
    foodItemId: ID!
    variationId: ID! # Refers to the _id of the Variation object within FoodItem.variations
    quantity: Int!
    addons: [OrderItemAddonInput!] # Optional
  }

  # OrderAddressInput is not strictly needed if we always use a pre-saved address via addressId for placing order.
  # The Order type will store an Address (snapshot of user's address).

  type SelectedAddon {
    # Denormalized titles and prices for historical accuracy in the order
    addonTitle: String!
    optionTitle: String!
    priceAtOrder: Float!
    # originalAddonId: ID # Optional: for linking back to the original Addon definition
    # originalSelectedOptionId: ID # Optional: for linking back to the original AddonOption definition
  }

  type OrderItem {
    _id: ID! # Auto-generated ObjectId for this specific line item
    foodItemSnapshot: FoodItem! # Denormalized snapshot of essential FoodItem fields (name, image etc.)
                                 # Can be populated with current FoodItem data on query if needed.
    foodItemId: ID! # Original FoodItem ID for reference
    variationSnapshot: Variation! # Denormalized snapshot of essential Variation fields (title, price etc.)
    variationId: ID! # Original Variation ID for reference
    quantity: Int!
    selectedAddons: [SelectedAddon!] # Denormalized selected addons with their prices at time of order
    unitPrice: Float! # Price of one unit (variation + selected addons) at time of order
    totalItemPrice: Float! # unitPrice * quantity
  }

  enum OrderStatus {
    PENDING     # Initial state after placement
    CONFIRMED   # Restaurant confirmed
    PREPARING   # Restaurant is preparing
    READY_FOR_PICKUP # Food is ready for rider
    PICKED_UP   # Rider has picked up
    DELIVERED   # Order delivered
    CANCELLED   # Order cancelled by user or system
    REJECTED    # Order rejected by restaurant
  }

  type Order {
    _id: ID!
    orderId: String! # User-friendly unique order identifier
    user: User!
    userId: ID!
    restaurantSnapshot: Restaurant!
    restaurantId: ID!
    items: [OrderItem!]!
    deliveryAddress: Address!
    paymentMethod: String!
    status: OrderStatus! # Changed from String to Enum
    tipping: Float
    taxAmount: Float!
    deliveryCharges: Float!
    subTotal: Float!
    totalAmount: Float!
    notes: String
    orderDate: String!
    expectedDeliveryTime: String
    preparationTimeMinutes: Int
    createdAt: String!
    updatedAt: String!
    # Timestamps for status changes
    confirmedAt: String
    preparingAt: String
    readyForPickupAt: String
    pickedUpAt: String
    deliveredAt: String
    cancelledAt: String
    rejectedAt: String
    # Payment related fields
    paymentStatus: String # e.g., PENDING, SUCCESSFUL, FAILED
    mockPaymentTransactionId: String
  }

  type Location {
    type: String # Should be "Point"
    coordinates: [Float!]! # [longitude, latitude]
  }

  input OpeningTimeEntryInput {
    day: String!
    times: [TimeSlotInput!]
  }

  input TimeSlotInput {
    startTime: String!
    endTime: String!
  }

  input RestaurantInput {
    name: String!
    image: String
    slug: String # Optional, can be auto-generated
    address: String!
    location: LocationInput!
    deliveryTime: String
    minimumOrder: Float
    tax: Float
    openingTimes: [OpeningTimeEntryInput!]
    isAvailable: Boolean
  }

  input CategoryInput {
    title: String!
    restaurantId: ID!
  }

  input AddonOptionInput {
    title: String!
    description: String
    price: Float!
  }

  input AddonInput {
    title: String!
    description: String
    options: [AddonOptionInput!]!
    quantityMinimum: Int!
    quantityMaximum: Int!
  }

  input VariationInput {
    title: String!
    price: Float!
    discounted: Float
    addons: [AddonInput!] # Embedded addons
  }

  input FoodItemInput {
    title: String!
    image: String
    description: String
    variations: [VariationInput!]!
    categoryId: ID!
    restaurantId: ID! # Should match category's restaurantId
    isAvailable: Boolean
  }

  # --- Existing Input Types ---
  input LocationInput {
    type: String # Default to "Point"
    coordinates: [Float!]!
  }

  input AddressInput {
    label: String
    deliveryAddress: String!
    details: String
    location: LocationInput!
  }

  type AuthPayload {
    token: String!
    userId: ID!
    name: String!
    email: String!
  }

  type Mutation {
    # Existing Mutations (User Auth, Address Management)
    register(name: String!, email: String!, password: String!, phone: String): AuthPayload!
    login(email: String!, password: String!): AuthPayload!
    updateUserProfile(name: String, phone: String): User
    sendOtpToEmail(email: String!): Boolean
    verifyEmailOtp(email: String!, otp: String!): AuthPayload
    sendOtpToPhone(phone: String!): Boolean
    verifyPhoneOtp(otp: String!): AuthPayload
    createAddress(addressInput: AddressInput!): User
    updateAddress(addressId: ID!, addressInput: AddressInput!): User
    deleteAddress(addressId: ID!): User
    selectAddress(addressId: ID!): User

    # Restaurant & Menu Write/Admin Mutations
    createRestaurant(input: RestaurantInput!): Restaurant
    updateRestaurant(id: ID!, input: RestaurantInput!): Restaurant
    createCategory(input: CategoryInput!): Category
    updateCategory(id: ID!, input: CategoryInput!): Category
    createFoodItem(input: FoodItemInput!): FoodItem
    updateFoodItem(id: ID!, input: FoodItemInput!): FoodItem
    _ensureRestaurantIndex: Boolean

    # Order Mutations
    placeOrder(restaurantId: ID!, items: [OrderItemInput!]!, paymentMethod: String!, addressId: ID!, tipping: Float, notes: String, preparationTimeMinutes: Int): Order
    updateOrderStatus(orderId: ID!, status: OrderStatus!): Order
  }
`;

module.exports = typeDefs;
