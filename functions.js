import { EmbedBuilder } from 'discord.js';
import { pgClient } from './postgres.js';


const checkEvent = async (eventId, guildId) => {
    const selectEventQuery = `SELECT * FROM events WHERE event_id=$1 and discord_id=$2;`;
    const selectResult = await pgClient.query(selectEventQuery, [eventId, guildId]);
    const eventCount = selectResult.rowCount;
    return eventCount;
};

export async function eventExists(eventMessage, eventId, guildId) {
    if (await checkEvent(eventId, guildId) === 0 ) {
        if (eventMessage) {
            // If event is not in db, but exists in channel - delete it
            eventMessage.delete();
        }
        return false;
    }
    return true;
}

export function combineDateAndTime(dateStr, timeStr) {
    // Parse the date string (DD.MM.YYYY)
    const [day, month, year] = dateStr.split('.').map(Number);
  
    // Extract hours and minutes from the UTC time string (HH:MM)
    const [hours, minutes] = timeStr.split(':').map(Number);
  
    // Create a Date object with the UTC time and parsed date
    // We need to use the format YYYY-MM-DDTHH:MM:00Z for UTC date-time
    const dateTimeString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`;
    
    // Return a Date object
    return new Date(dateTimeString);
  }

export function isValidSnowflake(value) {
    const regex = /^\d+$/; // This regex checks for one or more digits
    if (regex.test(value) && value <= 9223372036854775807) {
        return true;
    } else {
        logger.error(`Not a valid snowflake: ${value}`);
        return false;
    }
}

export async function getMessage(interaction, messageId) {
    try {
        // Try to fetch the message by its ID
        const message = await interaction.channel.messages.fetch(messageId);
        return message;  // Return message
    } catch (error) {
        if (error.code === 10008) {  // Unknown Message error code
            logger.error(`Message ${messageId} does not exist`);
            return null;  // Return null
        } else {
            logger.error(`An error occurred when retreiving the message: ${messageId}`, error.stack);
            throw error;  // Some other error occurred
        }
    }
}

export function extractKeywordAndTime(message, keyword) {
    // Regex for "X h Y m" format (hours and minutes)
    const timeRegexHoursMinutes = /(\d+)\s*h\s*(\d{2})/;
    // Regex for "X m Y s" format (minutes and seconds)
    const timeRegexMinutesSeconds = /(\d+)\s*m\s*(\d{2})/;
    // Regex for "X h" format (only hours)
    const timeRegexOnlyHours = /(\d+)\s*h/;
    // Regex for "X m" format (only minutes)
    const timeRegexOnlyMinutes = /(\d+)\s*m/;
    
    const timeMatchHoursMinutes = message.match(timeRegexHoursMinutes);
    const timeMatchMinutesSeconds = message.match(timeRegexMinutesSeconds);
    const timeMatchOnlyHours = message.match(timeRegexOnlyHours);
    const timeMatchOnlyMinutes = message.match(timeRegexOnlyMinutes);

    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    let totalSeconds = 0;
    const unixTimeNow = Math.floor(Date.now() / 1000);
    let unixTimeContent = unixTimeNow; // Default to current time if no match

    if (timeMatchHoursMinutes) {
        // If we matched "X h Y m" format
        hours = parseInt(timeMatchHoursMinutes[1], 10);
        minutes = parseInt(timeMatchHoursMinutes[2], 10);
        totalSeconds = (hours * 3600) + (minutes * 60); // Convert to seconds
        unixTimeContent = unixTimeNow + totalSeconds;
    } else if (timeMatchMinutesSeconds) {
        // If we matched "X m Y s" format
        minutes = parseInt(timeMatchMinutesSeconds[1], 10);
        seconds = parseInt(timeMatchMinutesSeconds[2], 10);
        totalSeconds = (minutes * 60) + seconds; // Convert to seconds
        unixTimeContent = unixTimeNow + totalSeconds;
    } else if (timeMatchOnlyHours) {
        // If we matched only "X h" format
        hours = parseInt(timeMatchOnlyHours[1], 10);
        totalSeconds = hours * 3600; // Convert to seconds
        unixTimeContent = unixTimeNow + totalSeconds;
    } else if (timeMatchOnlyMinutes) {
        // If we matched only "X m" format
        minutes = parseInt(timeMatchOnlyMinutes[1], 10);
        totalSeconds = minutes * 60; // Convert to seconds
        unixTimeContent = unixTimeNow + totalSeconds;
    }

    // Return the calculated Unix timestamp
    return unixTimeContent;
}

export function isValidTime(time) {
    // Regular expression to match HH:MM format
    const timePattern = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
    return timePattern.test(time);
}

export function isDateValid(dateString) {
    // Regular expression to match DD.MM.YYYY format
    const regex = /^\d{2}\.\d{2}\.\d{4}$/;

    // Check if it matches the regex
    if (!regex.test(dateString)) {
        return false;
    }

    // Split the string into day, month, and year
    const [day, month, year] = dateString.split('.').map(Number);
    // Check if the month is valid (1-12)
    if (month < 1 || month > 12) {
        return false;
    }

    // Check if the day is valid for the given month
    const daysInMonth = new Date(year, month, 0).getDate(); // 0th day of next month gives last day of this month
    if (day < 1 || day > daysInMonth) {
        return false;
    }

    return true;
}

export function buildEventMessage(eventParticipants, eventDetails) {
    const embed = new EmbedBuilder()
        .setTitle(eventDetails.event_name)
        .setDescription(`Date: **${eventDetails.date}**\nTime (UTC): **${eventDetails.time_utc}**`)
        .setColor('#0099ff');
    // Group roles by party
    const groupedRoles = eventParticipants.reduce((acc, { role_id, role_name, party, user_id }) => {
        if (!acc[party]) acc[party] = []; // Create a new array for the party if it doesn't exist
        acc[party].push({ role_id, role_name, user_id }); // Add role to the party group
        return acc;
    }, {});

    // Iterate through each party and format roles
    for (const party in groupedRoles) {
        let partyRoles = ''; // Initialize the role list for this party

        // Process each role in the party
        groupedRoles[party].forEach(({ role_id, role_name, user_id }) => {
            // Check if there's a participant for the role
            const status = user_id ? `<@${user_id}>` : 'Available'; // Format mention or 'Available'
            
            // Add formatted role to the party's list
            if (status === 'Available') {
                partyRoles += `\`🟩\` ${role_id}. ${role_name}\n`; // Available roles with green square
            } else {
                partyRoles += `\`✔️\` ${role_id}. ${role_name} - ${status}\n`; // Roles with a participant
            }
        });

        // Add the formatted roles list to the embed
        embed.addFields({ name: `⚔️ ${party}`, value: partyRoles, inline: true });
    }
    embed.setFooter({text: `Event ID: ${eventDetails.event_id}`});
    return embed;
}