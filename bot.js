// Discord.js imports
import { REST } from '@discordjs/rest';
import { ActionRowBuilder, Client, GatewayIntentBits, Events, StringSelectMenuBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { Routes } from 'discord-api-types/v9';

// Core modules
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import Fuse from 'fuse.js';

// Third-party modules
import axios from 'axios';
import Tesseract from 'tesseract.js';
import dotenv from 'dotenv';

// Internal modules
import { connectDb, disconnectDb, pgClient } from './postgres.js';
import { logger } from './winston.js';
import { commands } from './commands.js';
import { zones } from './zones.js';  // Import the array
import * as CTAManager from './Event.js';
import * as CompsManager from './Comps.js';
import { 
    extractKeywordAndTime 
} from './functions.js';
if (process.env.BOTENV != "PRODUCTION") {
    // Load environment variables from .env.dev if not production
    dotenv.config({path: '.env.dev'});
}




const rest = new REST({ version: '9' }).setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        logger.logWithContext('info','Started refreshing application (/) commands.');

        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
            body: commands,
        });

        logger.logWithContext('info','Successfully reloaded application (/) commands.');

        // Start the bot after command registration
        const client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, /*GatewayIntentBits.MessageContent,*/ GatewayIntentBits.GuildVoiceStates],
        });

        // Defining CTABot Admin Role in discord
        const guildRoleName = "CTABot Admin";

        client.once(Events.ClientReady, async () => {
            logger.logWithContext('info',`Bot has logged in as ${client.user.tag}`);
            const guildInfo = client.guilds.cache.map(guild => ({
                name: guild.name,
                id: guild.id
            }));
            logger.logWithContext('info','Bot is registered in the following servers:');
            guildInfo.forEach((guild, index) => {
                logger.logWithContext('info',`${index + 1}. ${guild.name} (ID: ${guild.id})`);
            });
            connectDb();
        });

        client.on(Events.GuildCreate, async (guild) => {
            logger.logWithContext('info',`Joined a new guild: ${guild.name}, ${guild.id}`);
            const existingRole = guild.roles.cache.find(role => role.name === guildRoleName);
            const botMember = guild.members.me;
            if (existingRole) {
                logger.logWithContext('info',`Role "${guildRoleName}" already exists.`);
            } else {
                if (botMember.permissions.has('ManageRoles')) {
                    const role = await guild.roles.create({
                        name: guildRoleName,
                        reason: 'Admin role to control CTABot',
                    });
                    logger.logWithContext('info',`Created role "${role.name}" in guild "${guild.name}".`);
                } else {
                    logger.logWithContext('info',`Bot lacks permission to manage roles in "${guild.name}".`);
                }
            } 
        });

        client.on(Events.InteractionCreate, async (interaction) => {
            const guildId = interaction.guildId; // Get the server ID
            const userId = interaction.user.id; // Get the User ID
            logger.setContext('guildId', guildId);
            logger.setContext('userId', userId);

            const member = await interaction.guild.members.fetch(userId);
            const hasRole = member.roles.cache.some(role => role.name === guildRoleName);
            
            // If no permissions are missing, proceed with the action
            if (interaction.isAutocomplete()) {
                if (interaction.commandName === 'ctabot') {
                    const subCommand = interaction.options.getSubcommand(false); // Get subcommand without erroring if none
                    if (subCommand === 'newcta' || subCommand === 'deletecomp' || subCommand === 'listcomps') {
                        const focusedValue = interaction.options.getFocused();
                        const guildId = interaction.guildId;

                        // Fetch available compositions from CompsManager
                        const compsArray = await CompsManager.getAllComps(guildId); 
                        const compositions = compsArray.value.map(row => row.comp_name);
                        // Filter compositions based on user input
                        const filtered = compositions
                            .filter(comp => comp.toLowerCase().includes(focusedValue.toLowerCase()))
                            .slice(0, 10); // Limit to 10 results
                            await interaction.respond(
                                filtered.map(comp => ({ name: comp, value: comp }))
                        );
                    }
                }
            } else {
                const requiredPermissions = [
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.EmbedLinks,
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageRoles
                    ];
                const channelPermissions = interaction.channel.permissionsFor(interaction.guild.members.me);
                const missingPermissions = requiredPermissions.filter(permission => !channelPermissions.has(permission));
                if (!channelPermissions) {
                    logger.logWithContext('error',`Couldn't retrieve the bot's permissions for channel.`);
                    return interaction.reply({content:"I couldn't retrieve the bot's permissions in this channel.", flags: MessageFlags.Ephemeral});   
                }
                if (missingPermissions.length > 0) {
                    const missingPermissionsNames = missingPermissions.map(permission => {
                        // Convert the PermissionFlags to their names (optional)
                        switch (permission) {
                            case PermissionFlagsBits.SendMessages:
                                return 'Send Messages';
                            case PermissionFlagsBits.EmbedLinks:
                                return 'Embed Links';
                            case PermissionFlagsBits.ViewChannel:
                                return 'View channel';
                            case PermissionFlagsBits.ReadMessageHistory:
                                return 'Read Message History';
                            case PermissionFlagsBits.ManageRoles: 
                                return 'Manage Roles';
                            default:
                                return 'Unknown Permission';
                        }
                    });
                    logger.logWithContext('error',`Missing permissions:  ${missingPermissionsNames.join(', ')}`);
                    return interaction.reply({content:`I am missing the following permissions: ${missingPermissionsNames.join(', ')}`, flags: MessageFlags.Ephemeral});
                }
            }
            if (interaction.isButton()){
                logger.logWithContext('info',`Button pressed: ${interaction.customId}`);
                // Handle Ping button
                if (interaction.customId.startsWith('ctaping')) {
                    const [action, eventId] = interaction.customId.split('|');
                    const event = await CTAManager.getEventAndMessage(interaction, eventId, guildId);
                    if (!event.success) {
                        return await interaction.reply({ content: event.error, flags: MessageFlags.Ephemeral });
                    }
                    let {eventDetails, eventMessage} = event.value;
                    if (userId != eventDetails.user_id && !hasRole) {
                        return await interaction.reply({ content: `Cancelling events is allowed only to the organizer of the event or CTABot Admin role`, flags: MessageFlags.Ephemeral });
                    }

                    const assignedUsers = eventDetails.rolesjson
                        .filter(role => role.user_id !== null)
                        .map(role => `<@${role.user_id}>`)
                        .join(", ");
                    
                    const result = assignedUsers.length > 0 
                        ? `<@${userId}> calls to arms! 🔔 ${assignedUsers}` 
                        : false;
                    if (!assignedUsers) {
                        return await interaction.reply({ content: "No one signed up, there is no one to ping 😢", flags: MessageFlags.Ephemeral});
                    } else {
                        return await interaction.reply({ content: result});
                    }
                }
                // Handle Leave Button
                if (interaction.customId.startsWith('leaveCTA')) {
                    const [action, eventId] = interaction.customId.split('|');
                    let eventMessage;
                    let eventDetails;
                    const event = await CTAManager.getEventAndMessage(interaction, eventId, guildId)
                    if (event.success) {
                        eventMessage = event.value.eventMessage;
                        eventDetails = event.value.eventDetails;
                    } else {
                        return await interaction.reply({ content: event.error, flags: MessageFlags.Ephemeral });
                    }
                    if (CTAManager.checkLock(eventDetails.date, eventDetails.time_utc, eventDetails.lock)) {
                        return await interaction.reply({ content: "Event is locked, you can't leave", flags: MessageFlags.Ephemeral });
                    }
                    const result = await CTAManager.leaveCTA(userId, eventDetails)
                    if (!result.success) {
                        return await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
                    }
                    await eventMessage.edit({ embeds: [result.value.embed] }); 
                    return await interaction.reply({ content: result.value.message, flags: MessageFlags.Ephemeral });                           
                }
                // Handle Join Button 
                if (interaction.customId.startsWith('joinCTA')) {
                    console.time('joinCTA');
                    const [action, eventId, compName] = interaction.customId.split('|');
                    const options = [];
                    const event = await CTAManager.getEventAndMessage(interaction, eventId, guildId);
                    if ( !event.success ) {
                        return await interaction.reply({content: event.error, flags: MessageFlags.Ephemeral});
                    }
                    const eventDetails = event.value.eventDetails;
                    const partiesWithFreeRoles = eventDetails.rolesjson
                        .filter(role => role.user_id === null) // Filter for roles where user_id is null
                        .map(role => role.party); // Extract the party names
                    const availableParties = [...new Set(partiesWithFreeRoles)];
                    if (availableParties.length === 0) {
                        return await interaction.reply({content: `There are no free roles left`, flags: MessageFlags.Ephemeral});
                    }
                    for (const party of availableParties) {
                        options.push({
                            label: party, // Display name
                            value: party, // Value to be returned on selection
                        });
                    }
                    const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`joinCTAParty|${eventId}|${compName}`)
                    .setPlaceholder('Select a party')
                    .setOptions(options);
                    
                    const row = new ActionRowBuilder().addComponents(selectMenu);
                    console.timeEnd('joinCTA');
                    await interaction.reply({
                        content: 'Please select a party:',
                        components: [row],
                        flags: MessageFlags.Ephemeral
                    });
                } 
            }
            if (interaction.isStringSelectMenu()) {
                logger.logWithContext('info',`Select menu interacted: ${interaction.customId}, selected value: ${interaction.values.join(", ")}`);
                if (interaction.customId.startsWith('joinCTARole')) {
                    console.time('joinCTARole');
                    const [action, eventId, compName, party] = interaction.customId.split('|');
                    const [roleId, roleName] = interaction.values[0].split('|');
                    const event = await CTAManager.getEventAndMessage(interaction, eventId, guildId); 
                    let eventMessage;
                    if (event.success) {
                        eventMessage = event.value.eventMessage; 
                    } else {
                        return await interaction.update({content: event.error, flags: MessageFlags.Ephemeral});
                    }                   
                    const eventDetails = event.value.eventDetails; 

                    const availableRoles = eventDetails.rolesjson
                        .filter(role => role.party === party && role.user_id === null);
                    if ( availableRoles.length === 0 ) {
                        return await interaction.reply({content: `There are no free roles left`, flags: MessageFlags.Ephemeral});
                    }
                    let roleChange = false;
                    eventDetails.rolesjson = eventDetails.rolesjson.map(role => {
                        if (role.user_id === userId) {
                            roleChange = true;
                            return { ...role, user_id: null }; // Remove the user from other roles
                        }
                        return role;
                    });
                    eventDetails.rolesjson = eventDetails.rolesjson.map(role => {
                        if (role.role_id === parseInt(roleId) && role.user_id === null) {
                            // Assign the new user_id to the role
                            return { ...role, user_id: userId };
                        }
                        return role; // Return unchanged role if no match
                    });

                    try {
                        const updateEvent = `
                            UPDATE events
                            SET rolesjson = $1
                            WHERE event_id = $2 AND discord_id = $3;
                        `;
                        await pgClient.query(updateEvent, [JSON.stringify(eventDetails.rolesjson), eventDetails.event_id, eventDetails.discord_id]);
                    } catch (error){
                        logger.logWithContext('error', `Error when inserting event ${eventId} to the database, ${error}`);
                        return {success: false, error: `Internal system error.`} 
                    }

                    // Rebuild the event post
                    const embed = CTAManager.buildEventMessage(eventDetails);
                    let message; 
                    if ( roleChange ) {
                        message = `You have switched the role to ${roleId}. ${roleName}`;
                    } else {
                        message = `Your role is: ${roleId}. ${roleName}`;
                    }
                    console.timeEnd('joinCTARole');
                    // Update the original message
                    await eventMessage.edit({ embeds: [embed] });                    
                    // Inform about teh role change
                    await interaction.update({
                        content: message,
                        components: [],
                        flags: MessageFlags.Ephemeral
                    });
                    
                }
                // Handle menu creation to choose a role in the party
                if (interaction.customId.startsWith('joinCTAParty')) {
                    console.time('joinCTAParty');
                    const [action, eventId, compName] = interaction.customId.split('|');
                    const party = interaction.values[0];
                    const event = await CTAManager.getEventAndMessage(interaction, eventId, guildId); 
                    if ( !event.success ) {
                        return await interaction.reply({content: event.error, flags: MessageFlags.Ephemeral});
                    }
                    const eventDetails = event.value.eventDetails;
                    const availableRoles = eventDetails.rolesjson
                        .filter(role => role.party === party && role.user_id === null);
                    if ( availableRoles.length === 0 ) {
                        return await interaction.reply({content: `There are no free roles left`, flags: MessageFlags.Ephemeral});
                    }
                    const options = [];
                    for (const { role_id: roleId, role_name: roleName } of availableRoles) {
                        options.push({
                            label: `${roleId}. ${roleName}`, // Display name
                            value: `${roleId}|${roleName}` // Value to be returned on selection
                        });
                    }
                    const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`joinCTARole|${eventId}|${compName}|${party}`)
                    .setPlaceholder(`Select a role`)
                    .setOptions(options);
                
                    const row = new ActionRowBuilder().addComponents(selectMenu);
                    console.timeEnd('joinCTAParty');
                    await interaction.update({
                        content: `Picked ${party}`,
                        components: [row],
                        flags: MessageFlags.Ephemeral
                    });
                }
            }
            
            if (!interaction.isCommand()) return;
            const { commandName, options } = interaction;

            // Log command with values
            let logMessage = `${commandName}`;

            if (options && options.getSubcommand) {
                const subCommand = options.getSubcommand();
                logMessage += ` ${subCommand}`;

                // Iterate over the raw options.data, which may contain subcommands
                options.data.forEach(option => {
                    // If the option is a subcommand (type: 1), we need to inspect the nested options
                    if (option.type === 1 && option.options) {
                        // Iterate over the nested options for this subcommand
                        option.options.forEach(subOption => {
                            logMessage += ` ${subOption.name}: ${subOption.value}`;
                        });
                    } else {
                        // Log the regular option (not a subcommand)
                        logMessage += ` ${option.name}: ${option.value}`;
                    }
                });
            }
            logger.logWithContext('info',`Command used: /${logMessage}`);
            
            // Handle /ctabot subcommands
            if (commandName === 'ctabot') {
                const subCommand = interaction.options.getSubcommand();
                if (subCommand === 'clearroles') {
                    const eventId = options.getString('eventid');   
                    const rolesString = options.getString('roles');
                    const roles =  rolesString.split(",").filter(item => item !== "");
                    const event = await CTAManager.getEventAndMessage(interaction, eventId, guildId);
                    if (!event.success) {
                        return await interaction.reply({ content: event.error, flags: MessageFlags.Ephemeral });
                    } 
                    let {eventDetails, eventMessage} = event.value; 
                    if (userId != eventDetails.user_id && !hasRole) {
                        return await interaction.reply({ content: `Freeing roles in the event allowed only to the organizer of the event or CTABot Admin role`, flags: MessageFlags.Ephemeral });
                    }
                    let removedParticipants = ''; 
                    for ( const role of roles) {
                        const removed = await CTAManager.removeParticipantByRoleID(role, eventDetails);
                        if (removed.success) {
                            eventDetails = removed.value.eventDetails;
                            removedParticipants += `<@${removed.value.removedUser}> removed from role ${role}.\n`;
                        }
                    }
                    let embed; 
                    if ( removedParticipants.length > 0 ) {
                        embed = CTAManager.buildEventMessage(eventDetails)
                        await eventMessage.edit({ embeds: [embed] });
                        return await interaction.reply({ content: removedParticipants, flags: MessageFlags.Ephemeral });
                    }
                    return await interaction.reply({ content: 'Roles are already free. No one has been removed', flags: MessageFlags.Ephemeral });
                }
                if (subCommand === 'ocr') {
                    const attachment = interaction.options.getAttachment('image');
                    if (!attachment) {
                        return interaction.reply({content: 'Please attach an image to perform OCR.', flags: MessageFlags.Ephemeral});
                    }
                    try {
                        await interaction.deferReply({flags: MessageFlags.Ephemeral});
                        const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
                        const __dirname = path.dirname(new URL(import.meta.url).pathname);
                        const imagePath = path.join(__dirname, 'temp_image.png');

                        // Save the image temporarily
                        fs.writeFileSync(imagePath, response.data);
                        const processedImagePath = path.join(__dirname, 'processed_image.png');

                        //const sharp = require('sharp');
                        await sharp(imagePath)
                            .resize({ width: 1600 }) // Resize width to 800px, keep aspect ratio
                            .grayscale() // Convert to grayscale
                            .normalize()
                            .threshold(120)
                            .modulate({ brightness: 1, contrast: 2 }) // Increase contrast
                            .toFile(processedImagePath);

                        
                        // Perform OCR on the image
                        const result = await Tesseract.recognize(processedImagePath, 'eng', {
                            //logger: m => console.log(m), // Logs OCR process
                            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.:, ',
                            psm: 11, // Assume a uniform block of text
                        });
                        const text = result.data.text;

                        const powerWords = ['strength moderate', 'strength substantial', 'strength rare', 'strength overwhelming', 'strength extraordinary', 'strength']
                        const powerFuse = new Fuse(powerWords, {
                            includeScore: true,
                            threshold: 0.4, // Adjust as needed (lower = stricter match)
                            minMatchCharLength: 5,
                            distance: 100,
                            ignoreLocation: true
                        });

                        const fuse = new Fuse(zones, {
                            includeScore: true,
                            threshold: 0.3, // Adjust as needed (lower = stricter match)
                            minMatchCharLength: 5,
                            distance: 50,
                            ignoreLocation: true
                        });

                        const cleanedText = text.replace(/[^\w\s]/g, ' ');  // Removes non-alphanumeric characters
                        const textLines = cleanedText.split('\n');
                        const cleanedTextLines = textLines
                            .map(line =>
                                line
                                .trim()
                                .replace(/\s+/g, ' ')                   // Normalize spaces
                                .toLowerCase()
                                .split(' ')                             // Split into words
                                .filter(word => word.length >= 3)       // Remove short words
                                .join(' ')                              // Join back into a line
                            )
                            .filter(line => line.length > 5);           // Optional: remove very short lines
                        let bestMatch = null; 
                        let bestPower = null;
                        let zone = null; 
                        let power = null;
                        console.log("OCR", cleanedTextLines);
                        cleanedTextLines.forEach((line) => {
                            console.log("Checking line: ", line);
                            const powerResult = powerFuse.search(line); 
                            if (powerResult.length > 0) {
                                console.log(`Candidate power: ${powerResult[0].item}, Score: ${powerResult[0].score}`);
                                const powerCandidate = {
                                    originalLine: powerResult[0], 
                                    matchedPower: powerResult[0].item,
                                    score: powerResult[0].score
                                }
                                if (!bestPower || powerCandidate.score < bestPower.score) {
                                    bestPower = powerCandidate; 
                                }
                            }
                            const zoneResult = fuse.search(line);
                            if (zoneResult.length > 0) {
                                console.log(`Candidate zone: ${zoneResult[0].item}, Score: ${zoneResult[0].score}`);
                                const candidate = {
                                    originalLine: zoneResult[0], 
                                    matchedZone: zoneResult[0].item,
                                    score: zoneResult[0].score
                                };
                                console.log(candidate);
                                if (!bestMatch || candidate.score < bestMatch.score) {
                                    bestMatch = candidate; 
                                }
                            }
                        })
                        console.log("Debug ", bestMatch);
                        console.log(bestMatch ? `Zone: ${bestMatch.matchedZone}` : "Zone: not found");
                        console.log(bestPower ? `Power: ${bestPower.matchedPower}` : "Power: not found");
                        if (bestMatch) {
                            zone = bestMatch.matchedZone; 
                        }
                        if (bestPower) {
                            power = bestPower.matchedPower;
                        }
                        console.log("PowerDbug", power);
                        // Clean up temporary file
                        fs.unlinkSync(imagePath);

                        // Send the extracted text back
                        if (text.trim()) {
                            const allContent = ['Small Treasure Chest', 'Medium Treasure Chest', 'Large Treasure Chest', 'Power Vortex', 'A \\w+ with plenty of Tier \\d\\.\\d \\w+', 'Power Anomaly'];
                            let message; // Default message
                            for (const keyword of allContent) {
                                const contentRegex = new RegExp(keyword, 'i');
                                if (contentRegex.test(text)) {
                                    const result = extractKeywordAndTime(text.trim(), keyword);
                                    let objective = text.match(contentRegex);
                                    console.log("Objective: " +  objective);
                                    console.log("Timestamp: " + result);
                                    if (objective == 'Power Anomaly') {
                                        if (power == 'strength overwhelming') {
                                            objective = '🟡 Golden core';
                                        } else if (power == 'strength substantial') {
                                            objective = '🔵 Blue core'; 
                                        } else if (power == 'strength moderate') {
                                            objective = '🟢 Green core'; 
                                        } else if (power == 'strength') {
                                            objective = '🟣 Purple core';
                                        } else {
                                            objective = 'Power core';
                                        }
                                    } 
                                    if (objective == 'Power Vortex') {
                                        if (power == 'strength overwhelming') {
                                            objective = '🟡 Golden vortex';
                                        } else if (power == 'strength substential') {
                                            objective = '🔵 Blue vortex'; 
                                        } else if (power == 'strength moderate') {
                                            objective = '🟢 Green vortex'; 
                                        } else if (power == 'strength') {
                                            objective = '🟣 Purple vortex'; 
                                        } else {
                                            objective = 'Power vortex';
                                        }
                                    } 
                                    if (zone && zone.length > 0) {
                                        message = `<@${userId}> has found ${objective} in ${zone} <t:${result}:R>!!!`;
                                    } else {
                                        message = `<@${userId}> has found ${objective} <t:${result}:R>!!!`;
                                    }
                                    
                                    break; // Exit the loop once a match is found
                                } else {
                                    message = 'Unrecognized content'
                                }
                            }
                            const isSuccessful = message !== 'Unrecognized content';
                            if (message === 'Unrecognized content') {
                                return interaction.editReply({files: [], content: 'Unrecognized content. Text recognition may fail if Albion uses non-native resolution. If you think it should be recognizable, send the screenshot to <@186362944022511616>', flags: MessageFlags.Ephemeral});
                            } else {
                                interaction.deleteReply();
                                return interaction.followUp({content: message, files: [attachment], ephemeral: false});
                            }
                        }      
                    } catch (error) {
                        logger.logWithContext('error',`Error when processing the image: ${error}`);
                        interaction.editReply({content: 'There was an error processing the image. Please try again.', flags: MessageFlags.Ephemeral});
                    }
                    
                }

                // Clear users not in the Voice Channel from the roles
                if (subCommand === 'prune') {
                    const eventId = options.getString('eventid');
                    const voiceChannel = member.voice.channel;
                    if (!voiceChannel) {
                        return interaction.reply({content: 'You are not in a voice channel!', flags: MessageFlags.Ephemeral});
                    }
                    const membersInChannel = voiceChannel.members;
                    const userList = new Set(membersInChannel.map(member => member.user.id)); 
                    const event = await CTAManager.getEventAndMessage(interaction, eventId, guildId)
                    let eventDetails, eventMessage;
                    if (event.success) {
                        ({eventDetails, eventMessage} = event.value); 
                    } else {
                        return await interaction.reply({content: event.error, flags: MessageFlags.Ephemeral});
                    }
                    if (userId != eventDetails.user_id && !hasRole) {
                        return await interaction.reply({ content: `Freeing roles in the event allowed only to the organizer of the event or CTABot Admin role`, flags: MessageFlags.Ephemeral });
                    }

                    const removedUsers = [];
                    for (const participant of eventDetails.rolesjson) {
                        if (participant.user_id !== null ) {
                            if (!userList.has(participant.user_id)) {
                                const response = await CTAManager.removeParticipantByUserID(participant.user_id,eventDetails);
                                if (response.success) {
                                    eventDetails = response.value;
                                    removedUsers.push(participant.user_id);
                                } 
                            }
                        }
                    }
                    if (removedUsers.length === 0 ) {
                        return interaction.reply({ content: `Wow! Everyone is in comms!`, flags: MessageFlags.Ephemeral });
                    } 
                    const embed = CTAManager.buildEventMessage(eventDetails);
                    await eventMessage.edit({ embeds: [embed] });
                    await interaction.reply({ content: `Users ${removedUsers.map(user => `<@${user}>`).join(', ')} have been cleared.`, flags: MessageFlags.Ephemeral });
                }

                if (subCommand === 'missing') {
                    const eventId = options.getString('eventid');
                    const voiceChannel = member.voice.channel;
                    if (!voiceChannel) {
                        return interaction.reply({content: 'You are not in a voice channel!', flags: MessageFlags.Ephemeral});
                    }
                    const membersInChannel = voiceChannel.members;
                    const userList = new Set(membersInChannel.map(member => member.user.id)); 
                    const event = await CTAManager.getEventAndMessage(interaction, eventId, guildId)
                    let eventDetails, eventMessage;
                    if (event.success) {
                        ({eventDetails, eventMessage} = event.value); 
                    } else {
                        return await interaction.reply({content: event.error, flags: MessageFlags.Ephemeral});
                    }
                    if (userId != eventDetails.user_id && !hasRole) {
                        return await interaction.reply({ content: `Pinging missing roles in the event is allowed only to the organizer of the event or CTABot Admin role`, flags: MessageFlags.Ephemeral });
                    }
                    const missingUsers = [];
                    for (const participant of eventDetails.rolesjson) {
                        if (participant.user_id !== null ) {
                            if (!userList.has(participant.user_id)) {
                                missingUsers.push(participant.user_id);
                            }
                        }
                    }
                    if (missingUsers.length === 0 ) {
                        return interaction.reply({ content: `Wow! Everyone is in comms!`, flags: MessageFlags.Ephemeral });
                    } 

                    await interaction.reply({ content: `${missingUsers.map(user => `<@${user}>`).join(', ')} are missing.`});
                }

                // Handle /ctabot cancelcta
                if (subCommand === 'cancelcta') {
                    const eventId = options.getString('id');
                    const result = await CTAManager.deleteCTA(eventId, guildId, userId, hasRole); 
                    if (result.success) {
                        //const event = await CTAManager.getEventAndMessage(interaction, eventId, guildId); 
                        const event = await CTAManager.getMessage(interaction, eventId);
                        if (event.success) {
                            event.value.delete();  
                            return await interaction.reply({ content: result.value, flags: MessageFlags.Ephemeral});
                        }
                    }
                    return await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral});
                }

                if (subCommand === 'editcta') {
                    const eventId = options.getString('eventid');
                    const eventName = options.getString('eventname');
                    const date = options.getString('date');
                    const time = options.getString('time');
                    
                    const event = await CTAManager.getEventAndMessage(interaction, eventId, guildId)
                    let eventDetails, eventMessage;
                    if (event.success) {
                        ({eventDetails, eventMessage} = event.value);
                        if (userId != eventDetails.user_id && !hasRole) {
                            return await interaction.reply({ content: `Editing events is allowed only to the organizer of the event or CTABot Admin role`, flags: MessageFlags.Ephemeral });
                        }
                        if (eventName) {
                            if (eventName.length > 255) {
                                return interaction.reply({content: 'Invalid event name: name should be less than 255 symbols', flags: MessageFlags.Ephemeral});
                            }
                            eventDetails.event_name = eventName;
                        }
                        if (date) {
                            if (!CTAManager.isValidDate(date)) {
                                return interaction.reply({content: 'Invalid date: date should be in DD.MM.YYYY format', flags: MessageFlags.Ephemeral});
                            }
                            eventDetails.date = date; 
                        } 
                        if (time) {
                            //if (!isValidTime(time)) {
                            //    return {success: false, error: 'Invalid time: time should be in HH:MM format'};
                            //}
                            eventDetails.time_utc = time; 
                        }
                        try {
                            const insertEvent = `
                                UPDATE events
                                SET event_name = $1, date = $2, time_utc = $3
                                WHERE event_id = $4;
                            `;
                            await pgClient.query(insertEvent, [eventDetails.event_name, eventDetails.date, eventDetails.time_utc, eventDetails.event_id]);
                        } catch (error){
                            logger.logWithContext('error', `Error when inserting event ${eventId} to the database`, error);
                            return {success: false, error: `Internal system error.`} 
                        }
                        const embed = CTAManager.buildEventMessage(eventDetails); 
                        await eventMessage.edit({ embeds: [embed] });
                        return await interaction.reply({content: `Event ${eventId} updated!`, flags: MessageFlags.Ephemeral});
                    } else {
                        return await interaction.reply({content: event.error, flags: MessageFlags.Ephemeral});
                    }
                }

                // Handle /ctabot newcta
                if (subCommand === 'newcta') {
                    const eventName = options.getString('eventname');
                    const date = options.getString('date');
                    const time = options.getString('time');
                    const compName = options.getString('comp');
                    const lock = options.getString('lock');
                    if (!eventName || !compName || !date || !time) {
                        return interaction.reply({content: 'Ivalid input: Event name, Date, Time and Comp name are required', flags: MessageFlags.Ephemeral});
                    }
                    if (eventName.length > 255) {
                        return interaction.reply({content: 'Invalid event name: name should be less than 255 symbols', flags: MessageFlags.Ephemeral});
                    }
                    if (!CTAManager.isValidDate(date)) {
                        return interaction.reply({content: 'Invalid date: date should be in DD.MM.YYYY format', flags: MessageFlags.Ephemeral});
                    }
                    if (!await CompsManager.isValidComp(compName, guildId)) {
                        return interaction.reply({content: `Composition ${compName} doesn't exist`, flags: MessageFlags.Ephemeral});
                    }
                    if (lock && !CTAManager.isValidTime(time)) {
                        return interaction.reply({content: `To enable locking, you need to provide time in HH:MM format`, flags: MessageFlags.Ephemeral});
                    }
                    const eventMessage = await interaction.deferReply({ withResponse: true });
                    console.log(eventMessage.id);
                    const cta = await CTAManager.createCTA(eventMessage.interaction.responseMessageId, eventName, userId, guildId, compName, date, time, lock); 
                    if ( cta.success ) {
                        interaction.editReply(cta.value);
                    } else {
                        interaction.deleteReply();
                        interaction.followUp({content: cta.error, flags: MessageFlags.Ephemeral});
                    }
                }
                if (subCommand === 'deletecomp') {
                    const compName = options.getString('compname');
                    const result = await CompsManager.deleteComp(compName, guildId, userId, hasRole); 
                    if (!result.success) {
                        return await interaction.reply({content: result.error, flags: MessageFlags.Ephemeral});
                    }
                    return await interaction.reply({content: result.value, flags: MessageFlags.Ephemeral});
                }                
                // Handle the /ctabot newcomp command
                if (subCommand === 'newcomp') {
                    const compName = options.getString('compname');
                    const rolesString = options.getString('comproles');
                    if (rolesString.split(';').length > 60) {
                        return await interaction.reply({ content: `Composition must have no more than 60 roles`, flags: MessageFlags.Ephemeral });
                    }                
                    const result = await CompsManager.newComp(compName, rolesString, guildId, userId);
                    if ( result.success ) {
                        return await interaction.reply({content: result.value, flags: MessageFlags.Ephemeral});
                    } else {
                        return await interaction.reply({content: result.error, flags: MessageFlags.Ephemeral});
                    }
                }
                /*
                if (subCommand === 'assign') {
                    const eventId = options.getString('event');
                    const playerId = options.getUser('player').id;
                    const roleId = options.getString('role');
                    const event = await CTAManager.getEventAndMessage(interaction, eventId, guildId); 
                    if (!event.success) {
                        return await interaction.update({content: event.error, flags: MessageFlags.Ephemeral});
                    } 
                    const eventMessage = event.value.eventMessage;                 
                    const eventDetails = event.value.eventDetails; 
                    let success = false;
                    eventDetails.rolesjson = eventDetails.rolesjson.map(role => {
                        if (role.role_id === parseInt(roleId) && role.user_id === null) {
                            // Assign the new user_id to the role
                            success = true;
                            return { ...role, user_id: playerId };
                        }
                        return role; // Return unchanged role if no match
                    });
                    let roleChange = false;
                    if (!success) {
                        const message = "Slot is already taken"
                        return await interaction.reply({
                            content: message,
                            components: [],
                            flags: MessageFlags.Ephemeral
                        });
                    }
                    eventDetails.rolesjson = eventDetails.rolesjson.map(role => {
                        if (role.user_id === playerId) {
                            roleChange = true;
                            return { ...role, user_id: null }; // Remove the user from other roles
                        }
                        return role;
                    });
                    
                    console.log(eventDetails.rolesjson);
                    try {
                        const updateEvent = `
                            UPDATE events
                            SET rolesjson = $1
                            WHERE event_id = $2 AND discord_id = $3;
                        `;
                        await pgClient.query(updateEvent, [JSON.stringify(eventDetails.rolesjson), eventDetails.event_id, eventDetails.discord_id]);
                    } catch (error){
                        logger.logWithContext('error', `Error when inserting event ${eventId} to the database, ${error}`);
                        return {success: false, error: `Internal system error.`} 
                    }

                    // Rebuild the event post
                    const embed = CTAManager.buildEventMessage(eventDetails);
                    const message = `<@${playerId}> assigned`;

                    
                    // Update the original message
                    await eventMessage.edit({ embeds: [embed] });                    
                    // Inform about the role change
                    await interaction.reply({
                        content: message,
                        components: [],
                        flags: MessageFlags.Ephemeral
                    });
                }
                */
                // Handle the /listcomps command
                if (subCommand === 'listcomps') {
                    const compName = options.getString('comp');
                    let result = [];                
                    // Check if a composition name is provided
                    if (compName) {
                        result = await CompsManager.getCompRoles(compName, guildId);
                        if (!result.success) {
                            return await interaction.reply({content: result.error, flags: MessageFlags.Ephemeral});
                        }
                        return await interaction.reply({content: `Roles in composition: \n${result.value.map(role => role.role_name).join(";")}`, flags: MessageFlags.Ephemeral});
                    } else {
                        result = await CompsManager.getAllComps(guildId); 
                        return await interaction.reply({content: `Available compositions: \n${result.value.map(comp => comp.comp_name).join(" \n")}`, flags: MessageFlags.Ephemeral});
                    }

                }
                
                if (subCommand === 'help') {
                    const response = `
## General
Add key players (e.g., shotcallers, admins) to the \`CTABot Admin\` role for managing and canceling events created by others.

## Composition Management
1. **Create Composition**:  
   \`/ctabot newcomp compname:<name> comproles:role1;role2;role3\`  
   List of roles must be separated by \`;\'. 
   Compositions with over 20 roles are split into multiple parties.  
2. **View Compositions**:  
   \`/ctabot listcomps\` or \`/ctabot listcomps compname:<name>\`.  
3. **Delete Composition**:  
   \`/ctabot deletecomp compname:<name>\` (Admins can delete any composition).  
   **WARNING**: Avoid deleting compositions used in upcoming events as it may break them. Cancel events using the composition first with \`/ctabot cancelcta id:<eventid>\`.  
   **Tip**: To edit, delete the old comp and create a new one with updated roles.

## Event Management
1. **Create Event**:  
   \`/ctabot newcta eventname:<title> date:<DD.MM.YYYY> time:<time> comp:<compname>\`  
   Event ID is shown at the bottom of the event form. You will need it for other event-related commands.   
2. **Cancel Event**:  
   \`/ctabot cancelcta id:<eventid>\` (Admins can cancel any event).  
3. **Edit Event**:  
   \`/ctabot editcta eventid:<eventid> eventname:<title> date:<DD.MM.YYYY> time:<time>\` (Admins can cancel any event).  
4. **Ping Signups**: Use the **Ping** button on the event form (Only event organizer and Admins).  
5. **Clear Roles**:  
   \`/ctabot clearroles eventid:<eventid> roles:<role1,role2>\`  
6. **Check Missing Players**:  
   \`/ctabot missing eventid:<eventid>\` to ping absent players. Use \`/ctabot prune eventid:<eventid>\` to free their roles.

## For Players
1. Join events using the **Join** button, selecting your party and role.  
2. Leave events using the **Leave** button.  

[**Detailed Guide**](https://gist.github.com/Vekeng/b69d35375e67f5db36f73f7d520d4914)
`;


                    await interaction.reply({content: response, flags: MessageFlags.Ephemeral});
                }              
            }
        });

        // Log in to Discord
        client.login(process.env.BOT_TOKEN);
    } catch (error) {
        logger.logWithContext('error', `${error}: ${error.stack}`);
    }
})();


// Gracefully disconnect from the database on bot shutdown
process.on('SIGINT', async () => {
    logger.logWithContext('Bot is shutting down...');
    await disconnectDb(); // Disconnect from the database
    process.exit(0); // Exit the process gracefully
});

process.on('SIGTERM', async () => {
    logger.logWithContext('Bot is terminating...');
    await disconnectDb(); // Disconnect from the database
    process.exit(0); // Exit the process gracefully
});