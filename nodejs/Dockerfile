# Use an official Node.js runtime as a parent image
FROM node:latest

# Set the working directory to /app
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY ./package*.json .

# Install the application dependencies
RUN npm install

# Copy the content of the local src directory to the working directory
COPY . .

# Make port 9145 available to the world outside this container
EXPOSE 9145

# Define environment variable
ENV NODE_ENV=production

# Run the node application
CMD ["node", "main.js"]
