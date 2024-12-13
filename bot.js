// Discord.js imports
import { REST } from '@discordjs/rest';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, GatewayIntentBits, Events, StringSelectMenuBuilder, PermissionFlagsBits, PartialGroupDMChannel } from 'discord.js';
import { Routes } from 'discord-api-types/v9';

// Core modules
import path from 'path';
import fs from 'fs';

// Third-party modules
import axios from 'axios';
import Tesseract from 'tesseract.js';
import dotenv from 'dotenv';

// Internal modules
import { botQueries, connectDb, disconnectDb, pgClient } from './postgres.js';
import { logger } from './winston.js';
import { commands } from './commands.js';
import * as CTAManager from './Event.js';
import * as CompsManager from './Comps.js';
import { 
    eventExists, 
    isValidSnowflake, 
    //getMessage, 
    extractKeywordAndTime, 
    buildEventMessage 
} from './functions.js';

// Load environment variables
dotenv.config();

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
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates],
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
                return interaction.reply({content:"I couldn't retrieve the bot's permissions in this channel.", ephemeral: true});
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
                return interaction.reply({content:`I am missing the following permissions: ${missingPermissionsNames.join(', ')}`, ephemeral: true});
            }
            // If no permissions are missing, proceed with the action
            if (interaction.isButton()){
                logger.logWithContext('info',`Button pressed: ${interaction.customId}`);
                // Handle Ping button
                if (interaction.customId.startsWith('ctaping')) {
                    const [action, eventId] = interaction.customId.split('|');
                    let response = '';
                    const eventDetails = await CTAManager.getEventByID(eventId, guildId);
                    if (userId != eventDetails.user_id && !hasRole) {
                        return await interaction.reply({ content: `Cancelling events is allowed only to the organizer of the event or CTABot Admin role`, ephemeral: true });
                    }
                    const participants = await CTAManager.getParticipants(eventId, guildId);
                    let attention = `<@${userId}> calls to arms! 🔔 `;
                    if (participants.length > 0) {
                        for ( const participant of participants ) {
                            if (participant.user_id != null ) {
                                response += `<@${participant.user_id}> `;
                            }
                        }
                        
                        if (response.length > 0) {
                            response = attention + response;
                            return await interaction.reply({ content: response});
                        } else {
                            return await interaction.reply({ content: 'No one signed up, there is no one to ping 😢', ephemeral: true});
                        } 
                    }
                }
                // Handle Leave Button
                if (interaction.customId.startsWith('leaveCTA')) {
                    const [action, eventId] = interaction.customId.split('|');
                    const eventMessage = await CTAManager.getMessage(interaction, eventId)
                    const result = await CTAManager.leaveCTA(userId, eventId, guildId)
                    if (!result.error) {
                        await eventMessage.edit({ embeds: [result.embed] });                        
                    }
                    await interaction.reply({ content: result.payload, ephemeral: true });
                }
                // Handle Join Button 
                if (interaction.customId.startsWith('joinCTA')) {
                    const [action, eventId, compName] = interaction.customId.split('|');
                    const options = [];
                    const eventMessage = await CTAManager.getMessage(interaction, eventId); 
                    const eventResponse = await CTAManager.getEventByID(eventId, guildId);
                    if ( eventResponse.error ) {
                        return eventResponse;
                    }
                    let availableParties; 
                    try {
                        const getParties = `
                            SELECT DISTINCT r.party
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
                                AND e.discord_id = $2
                                AND p.user_id IS NULL;
                        `;
                        availableParties = await pgClient.query(getParties, [eventId, guildId]);
                    } catch (error) {
                        logger.logWithContext('error', error);
                        return await interaction.reply({content: `Internal system error. Please contact the developer in https://discord.gg/tyaArtpytv`, ephemeral: true});
                    }
                    if (availableParties.rowCount === 0) {
                        return await interaction.reply({content: `There are no free roles left`, ephemeral: true});
                    }
                    for (const party of availableParties.rows) {
                        options.push({
                            label: party.party, // Display name
                            value: party.party, // Value to be returned on selection
                        });
                    }
                    const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`joinCTAParty|${eventId}|${compName}`)
                    .setPlaceholder('Select a party')
                    .setOptions(options);
                    
                    const row = new ActionRowBuilder().addComponents(selectMenu);
                    
                    await interaction.reply({
                        content: 'Please select a party:',
                        components: [row],
                        ephemeral: true
                    });
                } 
            }
            if (interaction.isStringSelectMenu()) {
                logger.logWithContext('info',`Select menu interacted: ${interaction.customId}, selected value: ${interaction.values.join(", ")}`);
                if (interaction.customId.startsWith('joinCTARole')) {
                    const [action, eventId, compName, party] = interaction.customId.split('|');
                    const [roleId, roleName] = interaction.values[0].split('|');
                    const eventMessage = await CTAManager.getMessage(interaction, eventId); 
                    let participant;
                    try {
                        const checkParticipant = `SELECT * FROM participants WHERE role_id=$1 AND event_id=$2 AND discord_id=$3`; 
                        participant = await pgClient.query(checkParticipant, [roleId, eventId, guildId]);
                    } catch (error) {
                        logger.logWithContext('error', error);
                        return await interaction.update({content: `Internal system error. Please contact the developer in https://discord.gg/tyaArtpytv`, ephemeral: true});
                    }
                    if (participant.rowCount === 1 ) {
                        const participantDetails = participant.rows[0];
                        if (participantDetails.user_id === userId) {
                            return await interaction.reply({ content: `You already has ${roleId}. ${roleName} assigned`, ephemeral: true});
                        } else {
                            return await interaction.reply({ content: `This role is already assigned to <@${participantDetails.user_id}>`, ephemeral: true});
                        }
                    }
                    let removeResult;
                    let insertResult;
                    try {
                        await pgClient.query('BEGIN');
                        const removeParticipantQuery = 'DELETE FROM participants WHERE user_id=$1 AND event_id=$2 AND discord_id=$3';
                        removeResult = await pgClient.query(removeParticipantQuery, [userId,eventId,guildId]); 
                        const insertParticipantQuery = `INSERT INTO participants VALUES ($1, $2, $3, $4, $5);`;
                        insertResult = await pgClient.query(insertParticipantQuery, [userId, roleId, compName, eventId, guildId]);
                        await pgClient.query('COMMIT');
                    } catch (error) {
                        logger.logWithContext('error', error);
                        await pgClient.query('ROLLBACK');
                        return await interaction.reply({content: `Internal system error. Please contact the developer in https://discord.gg/tyaArtpytv`, ephemeral: true});
                    }
                    const participants = await CTAManager.getParticipants(eventId, guildId); 
                    const eventDetails = await CTAManager.getEventByID(eventId, guildId); 
                    // Rebuild the event post
                    const embed = CTAManager.buildEventMessage(participants, eventDetails.payload);
                    let message; 
                    if ( removeResult.rowCount === 1 ) {
                        message = `You have switched the role to ${roleId}. ${roleName}`;
                    } else {
                        message = `Your role is: ${roleId}. ${roleName}`;
                    }
                    // Update the original message
                    await eventMessage.edit({ embeds: [embed] });                    
                    // Inform about teh role change
                    await interaction.update({
                        content: message,
                        components: [],
                        ephemeral: true
                    });
                    
                }
                // Handle menu creation to choose a role in the party
                if (interaction.customId.startsWith('joinCTAParty')) {
                    const [action, eventId, compName] = interaction.customId.split('|');
                    const party = interaction.values[0];
                    let availableRoles;
                    try {
                        availableRoles = await pgClient.query(botQueries.GET_AVAILABLE_ROLES_IN_PARTY, [eventId, guildId, party]);
                    } catch (error) {
                        logger.logWithContext('error', error); 
                        return await interaction.reply({content: `Internal system error. Please contact the developer in https://discord.gg/tyaArtpytv`, ephemeral: true});
                    }
                    if ( availableRoles.rowCount === 0 ) {
                        return await interaction.reply({content: `There are no free roles left`, ephemeral: true});
                    }
                    const options = [];
                    for (const { role_id: roleId, role_name: roleName } of availableRoles.rows) {
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
                    
                    await interaction.update({
                        content: `Picked ${party}`,
                        components: [row],
                        ephemeral: true
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
                    const event = await CTAManager.getEventByID(eventId, guildId); 
                    let removedParticipants = ''; 
                    if (!event.error) {
                        for ( const role of roles) {
                            const removed = await CTAManager.removeParticipantByRoleID(role, eventId, guildId); 
                            if (removed.rowCount > 0) {
                                removedParticipants += `<@${removed.rows[0].user_id}> removed from role ${role}.\n`;
                            }
                        }
                    } else {
                        return await interaction.reply({ content: event.payload, ephemeral: true });
                    }
                    let embed; 
                    let eventMessage; 
                    if ( removedParticipants.length > 0 ) {
                        eventMessage = await CTAManager.getMessage(interaction, eventId);
                        const participants = await CTAManager.getParticipants(eventId, guildId);
                        embed = CTAManager.buildEventMessage(participants, event.payload)
                        await eventMessage.edit({ embeds: [embed] });
                        return await interaction.reply({ content: removedParticipants, ephemeral: true });
                    }
                    return await interaction.reply({ content: 'Roles are already free. No one has been removed', ephemeral: true });
                }
                if (subCommand === 'ocr') {
                    const attachment = interaction.options.getAttachment('image');
                    if (!attachment) {
                        return interaction.reply({content: 'Please attach an image to perform OCR.', ephemeral: true});
                    }
                    try {
                        await interaction.deferReply({ephemeral: true});
                        const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
                        const __dirname = path.dirname(new URL(import.meta.url).pathname);
                        const imagePath = path.join(__dirname, 'temp_image.png');

                        // Save the image temporarily
                        fs.writeFileSync(imagePath, response.data);

                        // Perform OCR on the image
                        const result = await Tesseract.recognize(imagePath, 'eng');
                        const text = result.data.text;

                        // Clean up temporary file
                        fs.unlinkSync(imagePath);

                        // Send the extracted text back
                        if (text.trim()) {
                            const allContent = ['Power Vortex', 'A \\w+ with plenty of Tier \\d\\.\\d \\w+', 'Power Anomaly'];
                            let message; // Default message
                            for (const keyword of allContent) {
                                const contentRegex = new RegExp(keyword, 'i');
                                if (contentRegex.test(text)) {
                                    const result = extractKeywordAndTime(text.trim(), keyword);
                                    const match = text.match(contentRegex);
                                    message = `<@${userId}> has found ${match} is <t:${result}:R>!!!`;
                                    break; // Exit the loop once a match is found
                                } else {
                                    message = 'Unrecognized content'
                                }
                            }
                            const isSuccessful = message !== 'Unrecognized content';
                            if (message === 'Unrecognized content') {
                                return interaction.editReply({content: 'Unrecognized content. If you think it should be recognizable, send the screenshot to <@186362944022511616>', ephemeral: true});
                            } else {
                                interaction.deleteReply();
                                return interaction.followUp({content: message, files: [attachment], ephemeral: false});
                            }
                        }      
                    } catch (error) {
                        logger.logWithContext('error',`Error when processing the image: ${error}`);
                        interaction.editReply({content: 'There was an error processing the image. Please try again.', ephemeral: true});
                    }
                    
                }

                if (subCommand === 'myctas') {
                    const result = await CTAManager.getMyCTA(userId, guildId); 
                    return await interaction.reply({content: result.payload, ephemeral: true});
                }
                // Clear users not in the Voice Channel from the roles
                if (subCommand === 'prune') {
                    const messageId = options.getString('eventid');
                    if (!isValidSnowflake(messageId)) {
                        return await interaction.reply({ content: 'No proper Event ID provided', ephemeral: true});
                    }
                    const eventMessage = await getMessage(interaction, messageId);
                    if (!await eventExists(eventMessage, messageId, guildId)) {
                        return await interaction.reply({ content: 'Event doesn\'t exist in this channel', ephemeral: true});
                    }
                    const { rows : eventData } = await pgClient.query(botQueries.GET_EVENT, [messageId, guildId]);
                    const eventDetails = eventData[0]; 
                    if (userId != eventDetails.user_id && !hasRole) {
                        return await interaction.reply({ content: `Freeing roles in the event allowed only to the organizer of the event or CTABot Admin role`, ephemeral: true });
                    }
                    if (!member.voice.channel) {
                        return interaction.reply({content: 'You are not in a voice channel!', ephemeral: true});
                    }
                    //const eventDetails = eventData[eventMessage.id];
                    const { rows : participants } = await pgClient.query(botQueries.GET_EVENT_PARTICIPANTS, [messageId, guildId]);
                    const voiceChannel = member.voice.channel;
                    const membersInChannel = voiceChannel.members;
                    const userList = new Set(membersInChannel.map(member => member.user.id)); 
                    const removedUsers = [];
                    for (const participant of participants) {
                        if (participant.user_id !== null ) {
                            if (!userList.has(participant.user_id)) {
                                removedUsers.push(participant.user_id);
                            }
                        }
                    }
                    if (removedUsers.length === 0 ) {
                        return interaction.reply({ content: `Wow! Everyone is in comms!`, ephemeral: true });
                    } else { 
                        const removeParticipantQuery = 'DELETE FROM participants WHERE user_id=ANY($1) AND event_id=$2 AND discord_id=$3';
                        await pgClient.query(removeParticipantQuery, [removedUsers, messageId, guildId]);
                    }
                    const { rows : participantsAfter } = await pgClient.query(botQueries.GET_EVENT_PARTICIPANTS, [messageId, guildId]);
                    const embed = buildEventMessage(participantsAfter, eventDetails);
                    await eventMessage.edit({ embeds: [embed] });
                    await interaction.reply({ content: `Users ${removedUsers.map(user => `<@${user}>`).join(', ')} have been cleared.`, ephemeral: true });
                }

                // Handle /ctabot cancelcta
                if (subCommand === 'cancelcta') {
                    const eventId = options.getString('id');
                    const result = await CTAManager.deleteCTA(eventId, guildId, userId, hasRole); 
                    if (!result.error) {
                        const eventMessage = await CTAManager.getMessage(interaction, eventId); 
                        eventMessage.delete(); 
                    }
                    return await interaction.reply({ content: result.payload, ephemeral: true});
                }
                // Handle /ctabot newcta
                if (subCommand === 'newcta') {
                    const eventName = options.getString('eventname');
                    const date = options.getString('date');
                    const time = options.getString('time');
                    const compName = options.getString('comp');

                    const eventMessage = await interaction.deferReply({ fetchReply: true });
                    const result = await CTAManager.createCTA(eventMessage.id, eventName, userId, guildId, compName, date, time); 
                    if ( !result.error ) {
                        interaction.editReply(result.payload);
                    } else {
                        interaction.deleteReply();
                        interaction.followUp({content: result.payload, ephemeral: true});
                    }
                }
                if (subCommand === 'deletecomp') {
                    const compName = options.getString('compname');
                    const result = await CompsManager.deleteComp(compName, guildId, userId, hasRole); 
                    return await interaction.reply({content: result.payload, ephemeral: true});
                }                
                // Handle the /ctabot newcomp command
                if (subCommand === 'newcomp') {
                    const compName = options.getString('compname');
                    const rolesString = options.getString('comproles');
                    if (rolesString.length > 1600) {
                        return await interaction.reply({ content: `Composition shouldn't be longer than 1600 symbols. If you really need it, consider splitting list in two or more comps.`, ephemeral: true });
                    }                
                    const result = await CompsManager.newComp(compName, rolesString, guildId, userId);
                    return await interaction.reply({content: result.payload, ephemeral: true});
                }
                
                // Handle the /listcomps command
                if (subCommand === 'listcomps') {
                    const compName = options.getString('compname');
                    let result = '';                
                    // Check if a composition name is provided
                    if (compName) {
                        result = await CompsManager.getCompRoles(compName, guildId);
                    } else {
                        result = await CompsManager.getAllComps(guildId); 
                    }
                    // Send the response to the user
                    return await interaction.reply({content: result.payload, ephemeral: true});
                }
                
                if (subCommand === 'help') {
                    const response = `
**CTABot** is a Discord bot designed for managing Guild events in Albion Online. 
It helps players create and manage events and track participants. 
With CTABot, you can easily organize your CTAs, Outposts runs, and other content.

**Available Commands**
- **/ctabot newcta <name> <date> <time> <comp>**: Create a new event post with details like event name, date, time, and comp.
- **/ctabot newcomp <name> <list of roles>**: Create a new composition with a list of roles separated by semicolons \`;\`. If the list includes more than 20 roles, they will be split into two or more parties.
- **/ctabot deletecomp <compname>**: Deletes specified comp. Allowed only to "CTABot Admin" Role
- **/ctabot listcomps**: List all compositions available or view roles in a specific composition.
- **/ctabot cancelcta <eventId>**: Remove an event with the specified ID. Event ID can be found at the bottom of the event post.
- **/ctabot clearroles <eventId>**: Clear a specified list of roles in a specific event ID. The ID can be found at the bottom of the event post.
- **/ctabot prune <eventId>**: Removes people who are not in the current voice channel from their roles. 
- **/ctabot ocr <image>**: Posts and event with dynamic countdown. Image should be screenshot of an event, like Power Vortex, Power Anomaly, Pristine Resource. It recognizes only text you can see when clicking on an event on the global map. 
`;
                    await interaction.reply({content: response, ephemeral: true});
                }              
            }
        });

        // Log in to Discord
        client.login(process.env.BOT_TOKEN);
    } catch (error) {
        logger.logWithContext('critical', `${error}: ${error.stack}`);
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