const fs = require('fs').promises;
const path = require('path');

// Function to clean up events older than 7 days, taking the file path as an argument
async function loadAndCleanEvents(filePath) {
    console.log('Running cleanup...');
    const currentDate = new Date();

    try {
        // Load events from the specified file path
        const data = await fs.readFile(filePath, 'utf-8');
        const events = JSON.parse(data);

        // Array to store names of deleted events
        const deletedEventNames = [];

        // Filter events
        const updatedEvents = Object.fromEntries(
            Object.entries(events).filter(([id, event]) => {
                const { date, eventName } = event;

                // Validate date format (DD.MM.YYYY)
                const dateRegex = /^(\d{2})\.(\d{2})\.(\d{4})$/;
                const match = date.match(dateRegex);
                if (!match) {
                    // Keep event if date format is invalid
                    return true;
                }

                // Parse the date
                const [_, day, month, year] = match.map(Number);
                const eventDate = new Date(year, month - 1, day);

                // Handle cases where the event might refer to the previous year
                if (eventDate > currentDate) {
                    eventDate.setFullYear(currentDate.getFullYear() - 1);
                }

                // Calculate the difference in days
                const differenceInDays = (currentDate - eventDate) / (1000 * 60 * 60 * 24);

                // If event is older than 7 days, it will be removed, so we store its name
                if (differenceInDays > 7) {
                    deletedEventNames.push(eventName); // Add event name to deleted list
                    return false; // Remove the event
                }

                // Otherwise, keep the event
                return true;
            })
        );

        // Save the updated events back to the file
        await fs.writeFile(filePath, JSON.stringify(updatedEvents, null, 2), 'utf-8');

        // Log deleted event names
        if (deletedEventNames.length > 0) {
            console.log('Deleted events:');
            deletedEventNames.forEach(name => console.log(`- ${name}`));
        } else {
            console.log('No events were deleted.');
        }
        console.log('Old events cleaned up.');
        return updatedEvents;
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}

// Export the function so it can be used in other files
module.exports = {
    loadAndCleanEvents
};
