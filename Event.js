import { logger } from './winston.js';
import { combineDateAndTime } from './functions.js';
import { pgClient } from './postgres.js'
import * as CompsManager from './Comps.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, GatewayIntentBits, Events, StringSelectMenuBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { truncate } from 'fs';

/**
 * Creates a new Call to Arms (CTA) event.
 *
 * This function validates the input, inserts a new event into the database, retrieves associated participants, 
 * and generates an embed message along with interactive buttons for the event.
 *
 * @async
 * @function createCTA
 * @param {string} eventId - A unique identifier for the event.
 * @param {string} eventName - The name of the event.
 * @param {string} userId - The ID of the user creating the event.
 * @param {string} guildId - The Discord guild ID where the event is created.
 * @param {string} compName - The composition name associated with the event.
 * @param {string} date - The event date in DD.MM.YYYY format.
 * @param {string} time - The event time in HH:MM format.
 * @returns {Promise<Object>} A promise resolving to an object:
 * - On success: `{ success: true, value: { embeds, components, ephemeral } }` containing the embed and action row.
 * - On failure: `{ success: false, error: string }` with a descriptive error message.
 *
 * @example
 * const result = await createCTA('event123', 'Raid Night', 'user456', 'guild789', 'CompA', '25.12.2024', '20:00');
 * if (result.success) {
 *     console.log('CTA created:', result.value);
 * } else {
 *     console.error('Error creating CTA:', result.error);
 * }
 */
export async function createCTA(eventId, eventName, userId, guildId, compName, date, time, lock) {
    let eventRoles;
    try {
        const rolesResult = await CompsManager.getCompRoles(compName, guildId); 
        eventRoles = rolesResult.value.map(role => ({
            role_id: role.role_id,
            role_name: role.role_name,
            party: role.party, 
            user_id: null
        }));
        const jsonRoles = JSON.stringify(eventRoles);
        const insertEvent = `INSERT INTO events (event_id, event_name, user_id, discord_id, comp_name, date, time_utc, rolesjson, lock)
                                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`
        await pgClient.query(insertEvent, [eventId, eventName, userId, guildId, compName, date, time, jsonRoles, lock]);
    } catch (error){
        logger.logWithContext('error', `Error when inserting event ${eventId} to the database, ${error}`);
        return {success: false, error: `Internal system error.`} 
    }
        
    const joinButton = new ButtonBuilder()
        .setCustomId(`joinCTA|${eventId}|${compName}`)
        .setLabel('Join')
        .setStyle(ButtonStyle.Primary);
                    
    const leaveButton = new ButtonBuilder()
        .setCustomId(`leaveCTA|${eventId}`)
        .setLabel('Leave')
        .setStyle(ButtonStyle.Danger);
                    
    const pingButton = new ButtonBuilder()
        .setCustomId(`ctaping|${eventId}`)
        .setLabel('Ping')
        .setEmoji('⚔️')
        .setStyle(ButtonStyle.Danger);
                    
    const actionRow = new ActionRowBuilder().addComponents(joinButton, leaveButton, pingButton);
    const eventDetails = {
        event_id: eventId,
        event_name: eventName, 
        user_id: userId,
        guild_id: guildId,
        comp_name: compName,
        date: date, 
        time_utc: time,
        rolesjson: eventRoles
    };
    const embed = buildEventMessage(eventDetails);
    embed.setFooter({ text: `Event ID: ${eventId}` });
    return { success: true, value: {
        embeds: [embed],
        components: [actionRow]
    }}; 
}

export async function leaveCTA(userId, eventDetails) {
    const removedParticipant = await removeParticipantByUserID(userId, eventDetails);
    if (!removedParticipant.success) {
        return {success: false, error: removedParticipant.error}
    } 
    const message = `<@${userId}> removed from the event`;
    const embed = buildEventMessage(removedParticipant.value);
    return {success: true, value: {message: message, embed: embed}};        
}

/**
 * Removes a participant from an event by their user ID.
 *
 * This function deletes a participant from the database based on their user ID, event ID, and guild ID.
 * If successful, it returns the role IDs associated with the removed participant. If an error occurs, it provides an appropriate error response.
 *
 * @async
 * @function removeParticipantByUserID
 * @param {string} userId - The unique identifier of the user to be removed from the event.
 * @param {string} eventId - The unique identifier of the event.
 * @param {string} guildId - The Discord guild ID where the event is hosted.
 * @returns {Promise<Object>} A promise that resolves to an object containing the result:
 * - If successful: `{ success: true, value: Array }`, where `value` is an array of role IDs associated with the removed user.
 * - If an unexpected error occurs: `{ success: false, error: string }` indicating an internal system error.
 *
 * @example
 * const result = await removeParticipantByUserID('user123', 'event456', 'guild789');
 * if (result.success) {
 *     console.log('Removed roles for the participant:', result.value);
 * } else {
 *     console.error(result.error);
 * }
 */
export async function removeParticipantByUserID(userId, eventDetails) {
    let removed = false;
    eventDetails.rolesjson = eventDetails.rolesjson.map(role => {
        if (role.user_id === userId) {
            removed = true;
            return { ...role, user_id: null }; // Remove the user from other roles
        }
        return role;
    });
    if (!removed) {
        return {success: false, error: `<@${userId}> is not in the event`};
    }
    try {
        const updateEvent = `
            UPDATE events
            SET rolesjson = $1
            WHERE event_id = $2 AND discord_id = $3;
        `;
        await pgClient.query(updateEvent, [JSON.stringify(eventDetails.rolesjson), eventDetails.event_id, eventDetails.discord_id]);
        return {success: true, value: eventDetails}; 
    } catch (error){
        logger.logWithContext('error', `Error when inserting event ${eventId} to the database, ${error}`);
        return {success: false, error: `Internal system error.`} 
    }
}

/**
 * Removes a participant from an event by their role ID.
 *
 * This function deletes a participant from the database based on their role ID, event ID, and guild ID.
 * If successful, it returns the user ID of the removed participant. If an error occurs, it provides an appropriate error response.
 *
 * @async
 * @function removeParticipantByRoleID
 * @param {string} roleId - The unique identifier of the role associated with the participant.
 * @param {string} eventId - The unique identifier of the event.
 * @param {string} guildId - The Discord guild ID where the event is hosted.
 * @returns {Promise<Object>} A promise that resolves to an object containing the result:
 * - If successful: `{ success: true, value: Array }`, where `value` is an array of user IDs for the removed participants.
 * - If an unexpected error occurs: `{ success: false, error: string }` indicating an internal system error.
 *
 * @example
 * const result = await removeParticipantByRoleID('role123', 'event456', 'guild789');
 * if (result.success) {
 *     console.log('Removed participant(s):', result.value);
 * } else {
 *     console.error(result.error);
 * }
 */
export async function removeParticipantByRoleID(roleId, eventDetails) {
    let removedUser;
    eventDetails.rolesjson = eventDetails.rolesjson.map(role => {
        if (role.role_id === parseInt(roleId)) {
            removedUser = role.user_id;
            return { ...role, user_id: null }; // Remove the user from other roles
        }
        return role;
    });
    if (!removedUser) {
        return {success: false, error: `<@${roleId}> is free`};
    }
    try {
        const updateEvent = `
            UPDATE events
            SET rolesjson = $1
            WHERE event_id = $2 AND discord_id = $3;
        `;
        await pgClient.query(updateEvent, [JSON.stringify(eventDetails.rolesjson), eventDetails.event_id, eventDetails.discord_id]);
        return {success: true, value: {eventDetails: eventDetails, removedUser: removedUser}}; 
    } catch (error){
        logger.logWithContext('error', `Error when inserting event ${eventId} to the database, ${error}`);
        return {success: false, error: `Internal system error.`} 
    }
}


export async function deleteCTA(eventId, guildId, userId, hasRole) {
    if (!isValidSnowflake(eventId)){
        return {success: false, error: `Input error: event ID ${eventId} is invalid`};
    }
    const event = await getEventByID(eventId, guildId);
    if (!event.success) {
        return event;
    }
    if (event.value.user_id != userId && !hasRole) {
        return {success: false, error: `Cancelling events is allowed only to the organizer of the event or CTABot Admin role`}
    } 
    try {
        const deletedEventQuery = `DELETE FROM events WHERE event_id=$1 and discord_id=$2;`;
        await pgClient.query(deletedEventQuery, [eventId, guildId]);
        return {success: true, value: `Event ${eventId} has been cancelled`};
    } catch (error) {
        logger.log('error', error)
        return {success: false, error: `Internal system error`}
    }
}

/**
 * Fetches an event from the database by its ID and Discord guild ID.
 *
 * This function queries the database to find an event matching the provided `eventId` and `guildId`.
 * If the event exists, it returns the event details. If no event is found, or an error occurs, 
 * it returns an appropriate error response.
 *
 * @async
 * @function getEventByID
 * @param {string} eventId - The unique identifier of the event.
 * @param {string} guildId - The Discord guild ID associated with the event.
 * @returns {Promise<Object>} A promise that resolves to an object containing the result:
 * - If successful: `{ success: true, value: Object }` where `value` is the event details.
 * - If the event is not found: `{ success: false, error: string }` with a specific error message.
 * - If an unexpected error occurs: `{ success: false, error: string }` indicating an internal system error.
 *
 * @example
 * const result = await getEventByID('event123', 'guild456');
 * if (result.success) {
 *     console.log('Event details:', result.value);
 * } else {
 *     console.error('Error fetching event:', result.error);
 * }
 */
export async function getEventByID(eventId, guildId) {
    let event;
    try {
        const getEvent = `SELECT * FROM events WHERE event_id=$1 AND discord_id=$2`;
        event = await pgClient.query(getEvent, [eventId, guildId]);
        if (event.rowCount > 0) {
            return {success: true, value: event.rows[0]}; 
        } else {
            return {success: false, error: `Event ${eventId} doesn't exist`};
        }
    } catch (error) {
        logger.logWithContext('error', error); 
        return {success: false, error: `Internal system error`};
    }
}


/**
 * Checks whether a Call to Action (CTA) exists for a specific event and guild, and handles cases where the event or message might be missing.
 * - If both the event and message exist, returns them.
 * - If the event exists but the message doesn't, deletes the event.
 * - If the event doesn't exist but the message does, updates the message to indicate the event no longer exists.
 *
 * @async
 * @function
 * @param {object} interaction - The interaction object, typically from a Discord bot event.
 * @param {string} eventId - The unique identifier of the event to check.
 * @param {string} guildId - The unique identifier of the guild where the event and message are located.
 * @returns {Promise<{success: boolean, value?: Array, error?: string}>} 
 * - If successful, returns an object with `success: true` and the `values` array containing the event and message.
 * - If there are errors, returns an object with `success: false` and an error message in `error`.
 *
 * @throws {Error} Throws an error if there are issues with fetching event details or message (e.g., network issues, permissions).
 */
export async function getEventAndMessage(interaction, eventId, guildId) {
    if (!isValidSnowflake(eventId)) {
        return {success: false, error: `Input error: event ID ${eventId} is invalid`};
    }
    const eventDetails = await getEventByID(eventId, guildId); 
    const eventMessage = await getMessage(interaction, eventId); 
    // If both the event and message exist, returns them.
    if ( eventDetails.success && eventMessage.success ) {
        return { success: true, value: {eventDetails: eventDetails.value, eventMessage: eventMessage.value} }
    // if CTA exists in database, but message does not exist - delete event from the database
    } else if (eventDetails.success && !eventMessage.success) {
        //await deleteCTA(eventId, guildId, 'System', true); 
        return {success: false, error: eventMessage.error};
    }
    return {success: false, error: eventDetails.error};
}

/**
 * Builds a Discord embed message summarizing event details and participants.
 *
 * This function generates a formatted embed message containing event details such as 
 * the event name, date, and time. It organizes participants and roles by party, 
 * indicating whether each role is available or assigned to a participant.
 *
 * @function buildEventMessage
 * @param {Array<Object>} eventParticipants - The list of participants and their associated roles.
 * Each participant object should have the following properties:
 * - `role_id` {number} - The unique ID of the role.
 * - `role_name` {string} - The name of the role.
 * - `party` {string} - The name of the party to which the role belongs.
 * - `user_id` {string|null} - The Discord user ID of the participant, or `null` if the role is unassigned.
 * @param {Object} eventDetails - The details of the event.
 * The event details object should have the following properties:
 * - `event_name` {string} - The name of the event.
 * - `date` {string} - The date of the event.
 * - `time_utc` {string} - The time of the event in UTC.
 * - `event_id` {string} - The unique identifier of the event.
 * @returns {EmbedBuilder} A Discord embed object summarizing the event details and participants.
 *
 * @example
 * const eventParticipants = [
 *     { role_id: 1, role_name: 'Tank', party: 'Team A', user_id: '123456789012345678' },
 *     { role_id: 2, role_name: 'Healer', party: 'Team A', user_id: null },
 *     { role_id: 3, role_name: 'DPS', party: 'Team B', user_id: '987654321098765432' },
 * ];
 *
 * const eventDetails = {
 *     event_name: 'Epic Raid',
 *     date: '2024-12-25',
 *     time_utc: '18:00',
 *     event_id: 'event123',
 * };
 *
 * const embed = buildEventMessage(eventParticipants, eventDetails);
 * console.log(embed);
 */
export function buildEventMessage(eventDetails) {
    const participants = eventDetails.rolesjson;
    let time = eventDetails.time_utc;
    if (isValidTime(eventDetails.time_utc)) {
        const discordTime = convertToDiscordTimestamp(eventDetails.date, eventDetails.time_utc);
        time = `${eventDetails.time_utc} <t:${discordTime}:R>`;
    } 
    const embed = new EmbedBuilder()
        .setTitle(eventDetails.event_name)
        .setDescription(`Date: **${eventDetails.date}**\nTime (UTC): **${time}**`)
        .setColor('#0099ff');
    if (eventDetails.lock && eventDetails.lock > 0) {
        const discordTime = convertToDiscordTimestamp(eventDetails.date, eventDetails.time_utc);
        const locktime = discordTime - (eventDetails.lock * 60);
        embed.addFields({ name: '', value: `🔒 <t:${locktime}:R>`, inline: false });
    }
    // Group roles by party
    const groupedRoles = participants.reduce((acc, { role_id, role_name, party, user_id }) => {
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
    embed.addFields({ name: '', value: '[☕ Buy me a coffee](https://buymeacoffee.com/groovygrims)', inline: false });
    embed.setFooter({text: `Event ID: ${eventDetails.event_id}`});
    return embed;
}

/**
 * Fetches a specific message from a Discord channel by its ID.
 *
 * This function attempts to retrieve a message in the channel associated with the provided interaction.
 * If the message does not exist or an error occurs, it returns an appropriate error response.
 *
 * @async
 * @function getMessage
 * @param {Object} interaction - The Discord interaction object, which includes information about the channel.
 * @param {string} messageId - The unique identifier of the message to fetch.
 * @returns {Promise<Object>} A promise that resolves to an object containing the result:
 * - If successful: `{ success: true, value: Message }`, where `value` is the Discord `Message` object.
 * - If the message does not exist: `{ success: false, error: string }` with an appropriate error message.
 * - If an unexpected error occurs: `{ success: false, error: string }` indicating an internal server error.
 *
 * @example
 * // Example usage:
 * const result = await getMessage(interaction, '123456789012345678');
 * if (result.success) {
 *     console.log('Message retrieved:', result.value.content);
 * } else {
 *     console.error('Error fetching message:', result.error);
 * }
 */
export async function getMessage(interaction, messageId) {
    try {
        // Try to fetch the message by its ID
        const message = await interaction.channel.messages.fetch(messageId);
        return {success: true, value: message};  // Return message
    } catch (error) {
        if (error.code === 10008) {  // Unknown Message error code
            logger.logWithContext('error', `Message ${messageId} does not exist`);
            return {success: false, error: `Message ${messageId} does not exist`};  // Return null
        } else {
            logger.logWithContext('error', error);  
            return {success: false, error: `Internal server error`};
        }
    }
}

/**
 * Validates whether a given value is a valid Discord Snowflake.
 *
 * A Snowflake is a unique identifier used by Discord. It must be a numeric string consisting
 * of digits only and must be less than or equal to `9223372036854775807` (the maximum value
 * of a 64-bit signed integer).
 *
 * @function isValidSnowflake
 * @param {string|number} value - The value to validate as a Discord Snowflake.
 * @returns {boolean} `true` if the value is a valid Snowflake; `false` otherwise.
 *
 * @example
 * // Example usage:
 * const valid = isValidSnowflake('123456789012345678');
 * console.log(valid); // true
 *
 * const invalid = isValidSnowflake('notasnowflake');
 * console.log(invalid); // false
 *
 * const invalidNumber = isValidSnowflake('9223372036854775808');
 * console.log(invalidNumber); // false
 *
 * // Logs an error if the value is invalid
 * isValidSnowflake('invalid123');
 */
export function isValidSnowflake(value) {
    const regex = /^\d+$/; // This regex checks for one or more digits
    if (regex.test(value) && value <= 9223372036854775807) {
        return true;
    } else {
        logger.logWithContext('error', `Not a valid snowflake: ${value}`);
        return false;
    }
}

export function convertToDiscordTimestamp(dateStr, timeStr) {
    console.log(dateStr, timeStr);
    // Convert "DD.MM.YYYY HH:MM" to a proper Date object
    const [day, month, year] = dateStr.split('.').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);
    
    // Months are zero-based in JavaScript Date (0 = January)
    const unixTime = Date.UTC(year, month - 1, day, hours, minutes) / 1000;

    // Convert to Unix timestamp (in seconds)
    console.log(unixTime);
    
    return unixTime;

}

export function isValidTime(time) {
    // Regular expression to match HH:MM format
    const timePattern = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
    return timePattern.test(time);
}

export function isValidDate(date) {
    // Regular expression to match DD.MM.YYYY format
    const regex = /^\d{2}\.\d{2}\.\d{4}$/;

    // Check if it matches the regex
    if (!regex.test(date)) {
        return false;
    }

    // Split the string into day, month, and year
    const [day, month, year] = date.split('.').map(Number);
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

export function checkLock(date, time, lock) {
    const event_time = convertToDiscordTimestamp(date, time); 
    const lock_time = event_time - (lock * 60); 
    const current_timestamp = Math.floor(Date.now() / 1000);
    console.log("Current time: ", current_timestamp);
    console.log("Lock time: ", lock_time);
    console.log("Event time: ", event_time);
    if (current_timestamp > lock_time) {
        return true; 
    }
    return false; 
}