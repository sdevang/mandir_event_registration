# Use the official Node.js image as the base image
FROM --platform=linux/amd64 node:18

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json files to the working directory
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Set the environment variable for the host (use your production or development settings)
ENV PORT=3000

# Expose the application's port
EXPOSE 3000

# Start the Node.js application
CMD ["npm", "start"]
