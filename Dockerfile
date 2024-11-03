# Use the official Node.js image as the base image
FROM node:18

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to install dependencies
COPY . ./

# Install the bot's dependencies
RUN npm install

# Copy the rest of the bot's code into the container

# Expose any ports if necessary (not needed for a Discord bot but included for reference)
# EXPOSE 3000

# Command to run the bot
CMD ["node", "bot.js"]  # Replace 'your-bot-file.js' with the actual entry point of your bot

# Create persistent volumes for botData.json and roles.json
