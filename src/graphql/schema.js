const { gql } = require('apollo-server-express');

const typeDefs = gql`
  type Query {
    health: String
    userProfile: User # Requires authentication
    "Retrieves stores near a given location within a specified radius."
    nearByStores(latitude: Float!, longitude: Float!, radius: Float = 5.0): [Store!] # Renamed
    store(id: ID, slug: String): Store # Renamed
    myOrders(offset: Int, limit: Int): [Order!]
    orderDetails(orderId: ID!): Order
    getConfiguration: Configuration
    # New Review Queries
    reviewsForStore(storeId: ID!, offset: Int, limit: Int): [Review!]
    reviewsForProduct(productId: ID!, offset: Int, limit: Int): [Review!]
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
    # New configuration fields
    defaultAgeLimit: Int 
    idImageStorageBucket: String
  }

  type Subscription {
    orderStatusChanged(orderId: ID!): Order
  }

  enum IdStatusEnum {
    NOT_UPLOADED
    PENDING_VERIFICATION
    VERIFIED
    REJECTED
  }

  enum StoreTypeEnum {
    SMOKE_SHOP
    LIQUOR_STORE
    GENERAL_MERCHANDISE
  }

  enum ReviewTargetType {
    STORE
    PRODUCT
  }

  type Review {
    _id: ID!
    user: User! # User who wrote the review
    targetType: ReviewTargetType! # STORE or PRODUCT
    targetId: ID! # ID of the Store or Product being reviewed
    rating: Int! # e.g., 1-5 stars
    comment: String
    createdAt: String!
    updatedAt: String!
  }

  input ReviewInput {
    targetType: ReviewTargetType!
    targetId: ID!
    rating: Int! # Add validation (e.g., 1-5) in resolver
    comment: String
  }

  type Attribute {
    key: String!
    value: String!
  }

  input AttributeInput {
    key: String!
    value: String!
  }

  "Represents a user in the system."
  type User {
    id: ID!
    name: String!
    email: String!
    phone: String
    emailIsVerified: Boolean
    phoneIsVerified: Boolean
    addresses: [Address!]
    # ID Verification fields
    "URL of the uploaded ID image."
    idImageUrl: String
    "Current status of the user's ID verification."
    idVerificationStatus: IdStatusEnum!
    dateOfBirth: String # YYYY-MM-DD
    idRejectionReason: String
  }

  "Represents a store that offers products for sale."
  type Store { # Renamed from Restaurant
    _id: ID!
    "Display name of the store."
    name: String!
    image: String
    slug: String!
    address: String! # Full address string for the store
    location: Location! # GeoJSON Point for store location
    "Estimated time for order delivery or pickup, e.g., '1-2 hours', 'Next day'."
    estimatedDeliveryTime: String # Renamed from deliveryTime
    minimumOrder: Float # Minimum order value from this store
    tax: Float # Store-specific tax percentage
    reviewData: ReviewSummary # DEPRECATED by new fields
    categories: [Category!] # Product categories available in this store
    rating: Float # DEPRECATED by averageRating
    isAvailable: Boolean # Is the store currently open/taking orders
    openingTimes: [OpeningTimeEntry!]
    zone: Zone # Delivery zone information for the store
    licenseNumber: String # Optional license number
    storeType: StoreTypeEnum # Type of store
    # New Review-related fields
    reviews(offset: Int, limit: Int): [Review!]
    averageRating: Float
    reviewCount: Int
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
    products: [Product!] # Renamed from foods
    storeId: ID # Renamed from restaurantId, Reference to the store
  }

  "Represents a product sold by a store."
  type Product { # Renamed from FoodItem
    _id: ID!
    "Display title of the product."
    title: String!
    image: String
    description: String
    variations: [Variation!] # Product variations (e.g., size, color)
    isAvailable: Boolean # Default true, is the product available for sale
    categoryId: ID # Reference to the category this product belongs to
    storeId: ID # Renamed from restaurantId, Reference to the store this product belongs to
    "Brand of the product, e.g., 'Juul', 'Marlboro'."
    brand: String
    sku: String # Stock Keeping Unit
    volumeMl: Int # For liquids like e-juice
    nicotineMg: Float # For vape products
    attributes: [Attribute!] # Flexible key-value attributes
    # New Review-related fields
    reviews(offset: Int, limit: Int): [Review!]
    averageRating: Float
    reviewCount: Int
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
    addonId: ID! # Refers to the _id of the Addon object within Product.variations.addons
    selectedOptionId: ID! # Refers to the _id of the AddonOption within that Addon
  }

  input OrderItemInput {
    productId: ID! # Renamed from foodItemId
    variationId: ID! # Refers to the _id of the Variation object within Product.variations
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
    productSnapshot: Product! # Renamed from foodItemSnapshot
    productId: ID! # Renamed from foodItemId
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

  "Represents a customer's order."
  type Order {
    _id: ID!
    "User-friendly unique order identifier (e.g., ORD-timestamp-random)."
    orderId: String!
    user: User!
    userId: ID!
    storeSnapshot: Store! # Renamed from restaurantSnapshot
    storeId: ID! # Renamed from restaurantId
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
    # Delivery Verification fields
    deliveryIdImageUrl: String
    deliveryVerificationTimestamp: String
    deliveryRecipientNameMatchesId: Boolean
    deliveryRecipientIsOfLegalAge: Boolean
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

  input StoreInput { # Renamed from RestaurantInput
    name: String!
    image: String
    slug: String # Optional, can be auto-generated
    address: String! # Full address string for the store
    location: LocationInput! # GeoJSON Point for store location
    estimatedDeliveryTime: String # Renamed from deliveryTime
    minimumOrder: Float
    tax: Float
    openingTimes: [OpeningTimeEntryInput!]
    isAvailable: Boolean
    licenseNumber: String
    storeType: StoreTypeEnum
  }

  input CategoryInput {
    title: String!
    storeId: ID! # Renamed from restaurantId
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

  input ProductInput { # Renamed from FoodItemInput
    title: String!
    image: String
    description: String
    variations: [VariationInput!]! # Product variations
    categoryId: ID!
    storeId: ID! # Renamed from restaurantId, should match category's storeId
    isAvailable: Boolean
    brand: String
    sku: String
    volumeMl: Int
    nicotineMg: Float
    attributes: [AttributeInput!]
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

    # Store & Product Write/Admin Mutations (formerly Restaurant & Menu)
    createStore(input: StoreInput!): Store # Renamed
    updateStore(id: ID!, input: StoreInput!): Store # Renamed
    createCategory(input: CategoryInput!): Category # input now takes storeId
    updateCategory(id: ID!, input: CategoryInput!): Category
    createProduct(input: ProductInput!): Product # Renamed
    updateProduct(id: ID!, input: ProductInput!): Product # Renamed
    _ensureStoreIndex: Boolean # Renamed

    # Order Mutations
    "Places a new order. Requires user to have a VERIFIED ID status."
    placeOrder(storeId: ID!, items: [OrderItemInput!]!, paymentMethod: String!, addressId: ID!, tipping: Float, notes: String, preparationTimeMinutes: Int): Order # Renamed restaurantId to storeId
    updateOrderStatus(orderId: ID!, status: OrderStatus!): Order

    # ID Verification Mutations
    uploadIdImage(imageUrl: String!): User
    _admin_updateIdVerificationStatus(userId: ID!, status: IdStatusEnum!, dateOfBirth: String, rejectionReason: String): User

    # Delivery Verification Mutation
    confirmDeliveryWithId(orderId: ID!, deliveryIdImageUrl: String!, recipientNameMatchesId: Boolean!, recipientIsOfLegalAge: Boolean!): Order

    # Review Mutation
    "Submits a new review for a store or product, or updates an existing one."
    submitReview(input: ReviewInput!): Review
  }
`;

module.exports = typeDefs;
