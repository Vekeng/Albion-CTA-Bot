import { logger } from './winston.js';
import { combineDateAndTime } from './functions.js';
import { pgClient } from './postgres.js'
import * as CompsManager from './Comps.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, GatewayIntentBits, Events, StringSelectMenuBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';

export async function createCTA(eventId, eventName, userId, guildId, compName, date, time) {
    if (!eventName || !compName || !date || !time) {
        return {error: true, message: 'Ivalid input: Event name, Date, Time and Comp name are required'};
    }
    if (eventName.length > 255) {
        return {error: true, message: 'Invalid event name: name should be less than 255 symbols'};
    }
    if (!isValidDate(date)) {
        return {error: true, message: 'Invalid date: date should be in DD.MM.YYYY format'};
    }
    if (!isValidTime(time)) {
        return {error: true, message: 'Invalid time: time should be in HH:MM format'};
    }
    if (!await CompsManager.isValidComp(compName, guildId)) {
        return {error: true, message: `Composition ${compName} doesn't exist`};
    }
    try {
        const insertEvent = `INSERT INTO events (event_id, event_name, user_id, discord_id, comp_name, date, time_utc)
                                VALUES ($1, $2, $3, $4, $5, $6, $7);`
        await pgClient.query(insertEvent, [eventId, eventName, userId, guildId, compName, date, time]);
    } catch (error){
        logger.logWithContext('error', `Error when inserting event ${eventId} to the database`, error);
        return {error: true, message: `Internal system error. Please contact the developer in https://discord.gg/tyaArtpytv`} 
    }
    let participants; 
    try {
        participants = await getParticipants(eventId, guildId); 
    } catch (error) {
        logger.logWithContext('error', error);
        return {error: true, message: error}; 
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
        time: time
    };
    const embed = buildEventMessage(participants, eventDetails)
    embed.setFooter({ text: `Event ID: ${eventId}` });
    return { error: false, message: {
        embeds: [embed],
        components: [actionRow],
        ephemeral: false
    }}; 
}

export async function leaveCTA(userId, eventId, guildId) {
    const events = await getEvent(eventId, guildId); 
    let event;
    let message;
    if (events && events.length > 0) {
        event = events[0];
        console.log(event);
    } else {
        return {error: true, message: `${eventId} doesn't exist`};
    }
    const removedParticipant = await removeParticipant(userId, eventId, guildId);
    
    if (!removedParticipant) {
        return {error: true, message: `Internal system error. Please contact the developer in https://discord.gg/tyaArtpytv`}
    } else if (removedParticipant.rowCount > 0) {
        message = `<@${userId}> removed from the event`;
    } else {
        return {error: true, message: `<@${userId}> is not in the event`};
    }
    const participants = await getParticipants(eventId, guildId); 
    const embed = buildEventMessage(participants, event);
    return {error: false, message: message, embed: embed};        
}

export async function removeParticipant(userId, eventId, guildId) {
    try {
        const removeParticipant = 'DELETE FROM participants WHERE user_id=$1 AND event_id=$2 AND discord_id=$3';
        const participant = await pgClient.query(removeParticipant, [userId,eventId,guildId]); 
        return participant; 
    } catch (error) {
        logger.logWithContext('error', `Error removing participant ${userId} for event ID ${eventId}: ${error}`)
        return false; 
    }
}

export async function getMyCTA(userId, guildId) {
    let myCTAs;
    try {
        const getMyCTAs = `SELECT 
            e.event_id,
            e.event_name,
            e.date,
            e.time_utc,
            r.role_id,
            r.role_name,
            r.party
        FROM 
            participants p
        JOIN 
            events e 
            ON p.event_id = e.event_id AND p.discord_id = e.discord_id
        JOIN 
            roles r 
            ON p.role_id = r.role_id 
            AND p.comp_name = r.comp_name 
            AND p.discord_id = r.discord_id
        WHERE 
            p.user_id = $1
            AND p.discord_id = $2;
        `                                                                                                   
        myCTAs = await pgClient.query(getMyCTAs, [userId, guildId]);
    } catch {
        return
    }
    if ( myCTAs.rows.length > 0 ) {
        let message = 'Upcoming events you are signed up for: \n';
        for ( const row of myCTAs.rows ) {
            const today = new Date();
            const dateTime = combineDateAndTime(row.date, row.time_utc);
            if (dateTime.getTime() >= today.getTime()) {
                message += `🚩 ${row.event_name} on 📅 ${row.date} at ⌚ ${row.time_utc} as ⚔️ ${row.role_name}\n`;
            } 
        }
        return {error: false, message: message}
    } else {
        return {error: true, message: `You are not signed up for any CTAs`}; 
    }
}

export async function deleteCTA(eventId, guildId, userId, hasRole) {
    if (!isValidSnowflake(eventId)) {
        return {error: true, message: `Event ID ${eventId} is not valid`};
    }
    const events = await getEvent(eventId, guildId); 
    let event;
    if (events && events.length > 0) {
        event = events[0];
    } else {
        return {error: true, message: `${eventId} doesn't exist`};
    }
    if (event.user_id != userId && !hasRole) {
        return {error: true, message: `Cancelling events is allowed only to the organizer of the event or CTABot Admin role`}
    } 
    const deletedEventQuery = `DELETE FROM events WHERE event_id=$1 and discord_id=$2;`;
    try {
        await pgClient.query(deletedEventQuery, [eventId, guildId]);
        return {error: false, message: `Event ${eventId} has been cancelled`};
    } catch (error) {
        return {error: true, message: `Internal system error. Please contact the developer in https://discord.gg/tyaArtpytv`}
    }
}

export async function getEvent(eventId, guildId) {
    let event;
    try {
        const getEvent = `SELECT * FROM events WHERE event_id=$1 AND discord_id=$2`;
        event = await pgClient.query(getEvent, [eventId, guildId]);
        return event.rows; 
    } catch (error) {
        logger.logWithContext('error', error); 
        return null;
    }
}

export async function isCTAExists(eventId, guildId) {
    const selectEventQuery = `SELECT * FROM events WHERE event_id=$1 and discord_id=$2;`;
    const selectResult = await pgClient.query(selectEventQuery, [eventId, guildId]);
    const eventCount = selectResult.rowCount;
    if (eventCount === 0 ) {
        return false;
    }
    return true;
}

export function buildEventMessage(eventParticipants, eventDetails) {
    const embed = new EmbedBuilder()
        .setTitle(eventDetails.event_name)
        .setDescription(`Date: **${eventDetails.date}**\nTime (UTC): **${eventDetails.time}**`)
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

export async function getMessage(interaction, messageId) {
    try {
        // Try to fetch the message by its ID
        const message = await interaction.channel.messages.fetch(messageId);
        return message;  // Return message
    } catch (error) {
        if (error.code === 10008) {  // Unknown Message error code
            logger.logWithContext('error', `Message ${messageId} does not exist`);
            return null;  // Return null
        } else {
            logger.logWithContext('error', error);  
            return null; 
        }
    }
}

export function isValidSnowflake(value) {
    const regex = /^\d+$/; // This regex checks for one or more digits
    if (regex.test(value) && value <= 9223372036854775807) {
        return true;
    } else {
        logger.logWithContext('error', `Not a valid snowflake: ${value}`);
        return false;
    }
}

export async function getParticipants(eventId, guildId) {
    const getParticipants = `
        SELECT 
            r.role_id,
            r.role_name,
            r.party,
            p.user_id
        FROM
            roles r
        JOIN
            events e
        ON
            r.comp_name = e.comp_name
            AND r.discord_id = e.discord_id
        LEFT JOIN
            participants p
        ON
            p.role_id = r.role_id
            AND p.discord_id = r.discord_id
            AND p.comp_name = r.comp_name
            AND p.event_id = e.event_id
        WHERE
            e.event_id = $1
        AND
            e.discord_id = $2;
    `;
    let participants;
    try {
        participants = await pgClient.query(getParticipants, [eventId, guildId]);
        return participants.rows; 
    } catch (error) {
        logger.logWithContext('error', `Error fetching participants for event ID ${eventId}`, error)
        return {error: true, message: `Internal system error. Please contact the developer in https://discord.gg/tyaArtpytv`}
    }
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