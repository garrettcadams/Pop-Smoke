const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const jwt = require('jsonwebtoken');
const { PORT, JWT_SECRET } = require('./config');
const typeDefs = require('./graphql/schema');
const resolvers = require('./graphql/resolvers');
const { connectDB } = require('./db');

async function startServer() {
  // Connect to MongoDB
  try {
    await connectDB();
  } catch (err) {
    console.error('Failed to connect to MongoDB, server not starting.', err);
    process.exit(1); // Exit if DB connection fails
  }

  const app = express();

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: ({ req }) => {
      // Get the user token from the headers
      const token = req.headers.authorization || '';
      if (token) {
        try {
          // Remove "Bearer " prefix if present
          const actualToken = token.startsWith('Bearer ') ? token.slice(7) : token;
          // Verify token
          const decoded = jwt.verify(actualToken, JWT_SECRET);
          // Add the user to the context
          return { user: decoded }; // decoded should contain { id, email }
        } catch (e) {
          // Token is invalid or expired
          console.error('Token verification failed:', e.message);
          return {};
        }
      }
      return {};
    },
    formatError: (err) => {
      // Don't expose internal server errors to client in production
      if (err.extensions && err.extensions.code === 'INTERNAL_SERVER_ERROR' && process.env.NODE_ENV === 'production') {
        return new Error('Internal server error');
      }
      // Log the error
      console.error("GraphQL Error:", JSON.stringify(err, null, 2));
      return err;
    }
  });

  await server.start();
  server.applyMiddleware({ app });

  // Basic error handling middleware for Express
  app.use((err, req, res, next) => {
    console.error('Express Error Handler:', err.stack);
    res.status(500).send('Something broke!');
  });

  const httpServer = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}${server.graphqlPath}`);
    if (process.env.NODE_ENV === 'test') {
      console.log('Test environment detected, server will close shortly.');
      setTimeout(() => {
        console.log('Closing server...');
        httpServer.close(() => {
          console.log('Server closed.');
        });
      }, 5000);
    }
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
