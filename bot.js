// Discord.js imports
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, GatewayIntentBits, Events, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, SlashCommandBuilder, PermissionFlagsBits, ApplicationRoleConnectionMetadata, isValidationEnabled } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');

// Core modules
const path = require('path');
const fs = require('fs');
const { Console } = require('console');

// Third-party modules
const axios = require('axios');
const Tesseract = require('tesseract.js');
const dotenv = require('dotenv');

// Internal modules
const { botQueries, checkEvent, connectDb, disconnectDb, pgClient } = require('./postgres');
//require('./logger.js');
const { Logger } = require('./utility');
const { createBrotliCompress } = require('zlib');

// Initialize system logger
global.systemlog = new Logger();

// Load environment variables
dotenv.config();

// Command definitions
const commands = [
    {
        name: 'ctabot',
        description: 'CTA Bot commands',
        options: [{
            type: 1, 
            name: 'cancelcta',
            description: 'Cancel event',
            options: [{
                type: 3,
                name: 'id',
                description: 'Event ID',
                required: true
            }]
        },
        {
            type: 1, 
            name: 'prune',
            description: 'Remove people not in VC from the event',
            options: [{
                type: 3,
                name: 'eventid',
                description: 'Event ID',
                required: true
            }]
        },
        {
            name: 'help',
            description: 'How to use CTA BOT',
            type: 1
        },
        {
            name: 'myctas',
            description: 'List of CTAs you are signed for',
            type: 1
        },
        {
            name: 'ocr',
            description: 'Recognize event from screenshot',
            type: 1,
            options: [
                {
                    name: 'image',
                    type: 11, // ATTACHMENT
                    description: 'The image to perform OCR on.',
                    required: true,
                },
            ],
        },
        {
            name: 'deletecomp',
            description: 'Delete existing comp',
            type: 1,
            options: [
                {
                    name: 'compname',
                    type: 3, // ATTACHMENT
                    description: 'Type in the name of the comp to delete',
                    required: true,
                },
            ],
        },
        {
            type: 1, 
            name: 'newcomp',
            description: 'Create a new comp',
            options: [{
                type: 3,
                name: 'compname',
                description: 'Type in the name for the comp',
                required: true
            },
            {
                type: 3,
                name: 'comproles',
                description: 'Type in Roles in the comp separated by \`;\` (Example: 1H Mace; Hallowfall; Rift Glaive',
                required: true
            },
        ]
        },
        {
            name: 'listcomps',
            type: 1,
            description: 'List all compositions or roles from a specific composition.',
            options: [
                {
                    name: 'compname',
                    type: 3, // STRING
                    description: 'Name of the composition (optional)',
                    required: false,
                },
            ],
        },
        {
            type: 1,
            name: 'clearroles', 
            description: 'Free up listed roles (for example, if people are unavailable)',
            options: [{
                name: 'eventid',
                type: 3, // STRING
                description: 'Name of the event',
                required: true,
            },
            {
                name: 'roles',
                type: 3, // STRING
                description: 'List of roles to free up separated by commas (for example: 5,8,9,23)',
                required: true,
            }]
        },
        {
            type: 1, 
            name: 'newcta',
            description: 'Create new CTA event',
            options: [{
                name: 'eventname',
                type: 3, // STRING
                description: 'Name of the event',
                required: true,
            },
            {
                name: 'date',
                type: 3, // STRING
                description: 'Date of the event in DD.MM.YYYY format',
                required: true,
            },
            {
                name: 'time',
                type: 3, // STRING
                description: 'Time in HH:MM format',
                required: true,
            },
            {
                name: 'comp',
                type: 3, // STRING
                description: 'Composition name',
                required: true,
            }],
        }]
    },
];

async function eventExists(eventMessage, eventId, guildId, interaction) {
    if (await checkEvent(eventId, guildId) === 0 ) {
        if (eventMessage) {
            // If event is not in db, but exists in channel - delete it
            eventMessage.delete();
        }
        return false;
    }
    return true;
}

function combineDateAndTime(dateStr, timeStr) {
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

function isValidNumber(value) {
    const regex = /^\d+$/; // This regex checks for one or more digits
    if (regex.test(value) && value <= 9223372036854775807) {
        return true;
    } else {
        logger.error(`Not a valid snowflake: ${value}`);
        return false;
    }
}

async function getMessage(interaction, messageId) {
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

function extractKeywordAndTime(message, keyword) {
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

function isValidTime(time) {
    // Regular expression to match HH:MM format
    const timePattern = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
    return timePattern.test(time);
}

function isDateValid(dateString) {
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

function buildEventMessage(eventParticipants, eventDetails) {
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

const rest = new REST({ version: '9' }).setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        systemlog.info('Started refreshing application (/) commands.');

        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
            body: commands,
        });

        systemlog.info('Successfully reloaded application (/) commands.');

        // Start the bot after command registration
        const client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates],
        });

        // Defining CTABot Admin Role in discord
        const guildRoleName = "CTABot Admin";

        client.once(Events.ClientReady, async () => {
            systemlog.info(`Bot has logged in as ${client.user.tag}`);
            const guildInfo = client.guilds.cache.map(guild => ({
                name: guild.name,
                id: guild.id
            }));
            systemlog.info('Bot is registered in the following servers:');
            guildInfo.forEach((guild, index) => {
                systemlog.info(`${index + 1}. ${guild.name} (ID: ${guild.id})`);
            });
            connectDb();
        });

        client.on(Events.GuildCreate, async (guild) => {
            systemlog.info(`Joined a new guild: ${guild.name}, ${guild.id}`);
            const existingRole = guild.roles.cache.find(role => role.name === guildRoleName);
            const botMember = guild.members.me;
            if (existingRole) {
                systemlog.info(`Role "${guildRoleName}" already exists.`);
            } else {
                if (botMember.permissions.has('ManageRoles')) {
                    const role = await guild.roles.create({
                        name: guildRoleName,
                        reason: 'Admin role to control CTABot',
                    });
                    systemlog.info(`Created role "${role.name}" in guild "${guild.name}".`);
                } else {
                    systemlog.info(`Bot lacks permission to manage roles in "${guild.name}".`);
                }
            } 
        });

        client.on(Events.InteractionCreate, async (interaction) => {
            const guildId = interaction.guildId; // Get the server ID
            const userId = interaction.user.id; // Get the User ID

            // Initialize logger
            global.logger = new Logger(userId, guildId);
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
                logger.info(`Button pressed: ${interaction.customId}`);
                // Handle Ping button
                if (interaction.customId.startsWith('ctaping')) {
                    const [action, messageId] = interaction.customId.split('|');
                    const eventMessage = await getMessage(interaction, messageId); 
                    response = "";
                    if (!await eventExists(eventMessage, messageId, guildId, interaction)) {
                        return await interaction.reply({ content: 'Event doesn\'t exist in this channel', ephemeral: true});
                    }
                    const { rows : eventData } = await pgClient.query(botQueries.GET_EVENT, [messageId, guildId]);
                    const eventDetails = eventData[0]; 
                    if (userId != eventDetails.user_id && !hasRole) {
                        return await interaction.reply({ content: `Cancelling events is allowed only to the organizer of the event or CTABot Admin role`, ephemeral: true });
                    }
                    const { rows : participantsRows } = await pgClient.query(botQueries.GET_EVENT_PARTICIPANTS, [messageId, guildId]);
                    let attention = `<@${userId}> calls to arms! 🔔 `;
                    for ( const participant of participantsRows ) {
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
                // Handle Leave Button
                if (interaction.customId.startsWith('leaveCTA')) {
                    const [action, messageId] = interaction.customId.split('|');
                    const eventMessage = await getMessage(interaction, messageId); 
                    if (!await eventExists(eventMessage, messageId, guildId, interaction)) {
                        return await interaction.reply({ content: 'Event doesn\'t exist in this channel', ephemeral: true});
                    }
                    const removeParticipantQuery = 'DELETE FROM participants WHERE user_id=$1 AND event_id=$2 AND discord_id=$3';
                    await pgClient.query(removeParticipantQuery, [userId,messageId,guildId]); 
                    const eventParticipants = await pgClient.query(botQueries.GET_EVENT_PARTICIPANTS, [messageId, guildId]);
                    const eventDataResult = await pgClient.query(botQueries.GET_EVENT, [messageId, guildId]); 
                    const eventDetails = eventDataResult.rows[0];
                    embed = buildEventMessage(eventParticipants.rows, eventDetails);
                    await eventMessage.edit({ embeds: [embed] });
                    await interaction.reply({ content: `You have successfully left your role.`, ephemeral: true });
                }
                // Handle Join Button 
                if (interaction.customId.startsWith('joinCTA')) {
                    const [action, messageId, compName] = interaction.customId.split('|');
                    const options = [];
                    const eventMessage = await getMessage(interaction, messageId); 
                    if (!await eventExists(eventMessage, messageId, guildId, interaction)) {
                        return await interaction.reply({ content: 'Event doesn\'t exist in this channel', ephemeral: true});
                    }
                    try {
                        availablePartiesResult = await pgClient.query(botQueries.GET_AVAILABLE_PARTIES, [messageId, guildId]);

                        for (const party of availablePartiesResult.rows) {
                            options.push({
                                label: party.party, // Display name
                                value: party.party, // Value to be returned on selection
                            });
                        }
                        const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId(`joinCTAParty|${messageId}|${compName}`)
                        .setPlaceholder('Select a party')
                        .setOptions(options);
                    
                        const row = new ActionRowBuilder().addComponents(selectMenu);
                    
                        await interaction.reply({
                            content: 'Please select a party:',
                            components: [row],
                            ephemeral: true
                        });

                    } catch (error) {
                        logger.error('Error retrieving parties:', error.stack);
                        return await interaction.reply({ content: 'Error retrieving parties. Try again later', ephemeral: true});
                    }
                } 
            }
            if (interaction.isStringSelectMenu()) {
                logger.info(`Select menu interacted: ${interaction.customId}, selected value: ${interaction.values.join(", ")}`);
                if (interaction.customId.startsWith('joinCTARole')) {
                    const [action, messageId, compName, party] = interaction.customId.split('|');
                    const [roleId, roleName] = interaction.values[0].split('|');
                    const eventMessage = await getMessage(interaction, messageId); 
                    if (!await eventExists(eventMessage, messageId, guildId, interaction)) {
                        return await interaction.reply({ content: 'Event doesn\'t exist in this channel', ephemeral: true});
                    }
                    const checkParticipantQuery = `SELECT * FROM participants WHERE role_id=$1 AND event_id=$2 AND discord_id=$3`; 
                    const resultCheckParticipant = await pgClient.query(checkParticipantQuery, [roleId, messageId, guildId]);
                    const participantCount = resultCheckParticipant.rows.length;
                    if (participantCount === 1 ) {
                        const participantDetails = resultCheckParticipant.rows[0];
                        if (participantDetails.user_id === userId) {
                            return await interaction.reply({ content: `You already has ${roleName} assigned`, ephemeral: true});
                        } else {
                            return await interaction.reply({ content: `This role is already assigned to <@${participantDetails.user_id}>`, ephemeral: true});
                        }
                    }
                    const removeParticipantQuery = 'DELETE FROM participants WHERE user_id=$1 AND event_id=$2 AND discord_id=$3';
                    await pgClient.query(removeParticipantQuery, [userId,messageId,guildId]); 
                    const insertParticipantQuery = `INSERT INTO participants VALUES ($1, $2, $3, $4, $5);`;
                    const resultInsertParticipants = await pgClient.query(insertParticipantQuery, [userId, roleId, compName, messageId, guildId]);
                    
                    const eventParticipants = await pgClient.query(botQueries.GET_EVENT_PARTICIPANTS, [messageId, guildId]);

                    const eventDataResult = await pgClient.query(botQueries.GET_EVENT, [messageId, guildId]); 
                    const eventDetails = eventDataResult.rows[0];
                    // Rebuild the event post
                    const embed = buildEventMessage(eventParticipants.rows, eventDetails);

                    // Update the original message
                    await eventMessage.edit({ embeds: [embed] });                    
                    // Inform about teh role change
                    await interaction.update({
                        content: `Your role is: ${roleId}. ${roleName}`,
                        components: [],
                        ephemeral: true
                    });
                    
                }
                // Handle menu creation to choose a role in the party
                if (interaction.customId.startsWith('joinCTAParty')) {
                    const [action, messageId, compName] = interaction.customId.split('|');
                    const party = interaction.values[0];
                    const eventMessage = await getMessage(interaction, messageId); 
                    if (!await eventExists(eventMessage, messageId, guildId, interaction)) {
                        return await interaction.reply({ content: 'Event doesn\'t exist in this channel', ephemeral: true});
                    }
                    availableRolesInPartyResult = await pgClient.query(botQueries.GET_AVAILABLE_ROLES_IN_PARTY, [messageId, guildId, party]);
                    const options = [];
                    for (const { role_id: roleId, role_name: roleName } of availableRolesInPartyResult.rows) {
                        options.push({
                            label: `${roleId}. ${roleName}`, // Display name
                            value: `${roleId}|${roleName}` // Value to be returned on selection
                        });
                    }
                    const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`joinCTARole|${messageId}|${compName}|${party}`)
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
            logger.info(`Command used: /${logMessage}`);
            
            // Handle /ctabot subcommands
            if (commandName === 'ctabot') {
                const subCommand = interaction.options.getSubcommand();
                if (subCommand === 'clearroles')
                {   
                    const rolesString = options.getString('roles');
                    const role_ids =  rolesString.split(",").filter(item => item !== "");
                    const messageId = options.getString('eventid');
                    if (!isValidNumber(messageId)) {
                        return await interaction.reply({ content: 'No proper Event ID provided', ephemeral: true});
                    }
                    const eventMessage = await getMessage(interaction, messageId);
                    if (!await eventExists(eventMessage, messageId, guildId, interaction)) {
                        return await interaction.reply({ content: 'Event doesn\'t exist in this channel', ephemeral: true});   
                    }   
                    const { rows : eventData } = await pgClient.query(botQueries.GET_EVENT, [messageId, guildId]);
                    if ( eventData.length === 1 ) {
                        
                        const removeParticipantQuery = 'DELETE FROM participants WHERE role_id=ANY($1) AND event_id=$2 AND discord_id=$3';
                        await pgClient.query(removeParticipantQuery, [role_ids,messageId,guildId]);
                        const eventDetails = eventData[0]
                        const { rows : eventParticipants } = await pgClient.query(botQueries.GET_EVENT_PARTICIPANTS, [messageId, guildId]);
                        embed = buildEventMessage(eventParticipants, eventDetails);
                    }
                    
                    await eventMessage.edit({ embeds: [embed] });
                    await interaction.reply({ content: `Roles ${role_ids} have been cleared.`, ephemeral: true });
                }
                if (subCommand === 'ocr') {
                    const attachment = interaction.options.getAttachment('image');
                    if (!attachment) {
                        return interaction.reply({content: 'Please attach an image to perform OCR.', ephemeral: true});
                    }
                    try {
                        await interaction.deferReply({ephemeral: true});
                        const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
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
                        logger.error(`Error when processing the image`, error);
                        interaction.editReply({content: 'There was an error processing the image. Please try again.', ephemeral: true});
                    }
                    
                }

                if (subCommand === 'myctas') {
                    const { rows : myCtaRows } = await pgClient.query(botQueries.GET_MYCTAS, [userId, guildId]);
                    if ( myCtaRows.length > 0 ) {
                        message = 'Upcoming events: \n';
                        for ( row of myCtaRows ) {
                            const today = new Date();
                            const dateTime = combineDateAndTime(row.date, row.time_utc);
                            if (dateTime.getTime() >= today.getTime()) {
                                message += `🚩 ${row.event_name} on 📅 ${row.date} at ⌚ ${row.time_utc} as ⚔️ ${row.role_name}\n`;
                            } 
                        }
                        return await interaction.reply({ content: message, ephemeral: true});
                    } else {
                        return await interaction.reply({ content: 'There are no events you are signed up for', ephemeral: true});
                    }
                }

                // Clear users not in the Voice Channel from the roles
                if (subCommand === 'prune') {
                    const messageId = options.getString('eventid');
                    if (!isValidNumber(messageId)) {
                        return await interaction.reply({ content: 'No proper Event ID provided', ephemeral: true});
                    }
                    const eventMessage = await getMessage(interaction, messageId);
                    if (!await eventExists(eventMessage, messageId, guildId, interaction)) {
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
                    embed = buildEventMessage(participantsAfter, eventDetails);
                    await eventMessage.edit({ embeds: [embed] });
                    await interaction.reply({ content: `Users ${removedUsers.map(user => `<@${user}>`).join(', ')} have been cleared.`, ephemeral: true });
                }

                // Handle /ctabot cancelcta
                if (subCommand === 'cancelcta') {
                    const eventId = options.getString('id');
                    if (!isValidNumber(eventId)) {
                        return await interaction.reply({ content: 'No proper Event ID provided', ephemeral: true});
                    }
                    const eventMessage = await getMessage(interaction, eventId); 
                    const selectResult = await pgClient.query(botQueries.GET_EVENT, [eventId, guildId]);
                    const eventCount = selectResult.rowCount;
                    if (await checkEvent(eventId, guildId) === 0 ) {
                        if (eventMessage) {
                            // If event is not in db, but exists in channel - delete it
                            eventMessage.delete();
                        }
                        return await interaction.reply({ content: 'Event doesn\'t exist in this channel', ephemeral: true});
                    }
                    const eventDetails = selectResult.rows[0];
                    if (userId != eventDetails.user_id && !hasRole)
                    {
                        return await interaction.reply({ content: `Cancelling events is allowed only to the organizer of the event or CTABot Admin role`, ephemeral: true });
                    }
                    
                    const deletedEventQuery = `DELETE FROM events WHERE event_id=$1 and discord_id=$2;`;
                    await pgClient.query(deletedEventQuery, [eventId, guildId]);
                    eventMessage.delete();
                    await interaction.reply({ content: `Event ${eventMessage} successfully deleted`, ephemeral: true });
                }
                // Handle /ctabot newcta
                if (subCommand === 'newcta') {
                    const eventName = options.getString('eventname');
                    const date = options.getString('date');
                    const timeUTC = options.getString('time');
                    const compName = options.getString('comp');
                    //const participants = {};
                                
                    const getComps = `SELECT comp_name FROM compositions WHERE comp_name=$1 AND discord_id=$2;`;
                    const { rows : compsRows } = await pgClient.query(getComps, [compName, guildId])
                    if ( compsRows.length === 0 ) {
                        return await interaction.reply({ content: `Composition "${compName}" doesn't exist`, ephemeral: true });
                    }
                    if (!isDateValid(date)) {
                        return await interaction.reply({ content: `${date} is not valid date. Date must be in DD.MM.YYYY format`, ephemeral: true });
                    }
                    if (!isValidTime(timeUTC)) {
                        return await interaction.reply({ content: `${timeUTC} is not valid time. Time must be in HH:MM format`, ephemeral: true });
                    }
                    message = await interaction.deferReply({ fetchReply: true });
                    const eventId = message.id
                    const eventDetails = {
                        event_id: eventId,
                        event_name: eventName, 
                        user_id: userId,
                        guild_id: guildId,
                        comp_name: compName,
                        date: date, 
                        time_utc: timeUTC
                    };
                    try {
                        // Insert the event into the events table
                        const res = await pgClient.query(botQueries.INSERT_EVENT, Object.values(eventDetails));
                    } catch (error) {
                        logger.error('Error creating event:', error);
                        return await interaction.reply({ content: 'There was an error creating the event.', ephemeral: true });
                    }
                    
                    try {
                        eventParticipants = await pgClient.query(botQueries.GET_EVENT_PARTICIPANTS, [eventId, guildId]);
                    } catch (error) {
                        logger.error('Error creating event:', error);
                        return await interaction.reply({ content: 'There was an error gettimg roles for the evnt.', ephemeral: true });
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
                    embed = buildEventMessage(eventParticipants.rows, eventDetails)
                    embed.setFooter({ text: `Event ID: ${eventId}` });
                    await interaction.editReply({
                        embeds: [embed],
                        components: [actionRow]
                    });
                }
                if (subCommand === 'deletecomp') {
                    const compName = options.getString('compname');
                    try {
                        // Check if the composition exists in the database
                        const checkQuery = `SELECT * FROM compositions WHERE discord_id = $1 AND comp_name = $2;`;
                        const checkRes = await pgClient.query(checkQuery, [guildId, compName]);
                        if (checkRes.rows.length === 0) {
                            return await interaction.reply({ content: `Comp ${compName} doesn't exist`, ephemeral: true });
                        }
                        if (checkRes.rows[0].owner !== userId || !hasRole) {
                            return await interaction.reply({ content: `Only composition owner or user with CTABot Admin role can edit this`, ephemeral: true });
                        }
                
                        // Delete roles associated with this composition
                        const deleteRolesQuery = `DELETE FROM roles WHERE comp_name = (SELECT comp_name FROM compositions WHERE discord_id = $1 AND comp_name = $2);`;
                        await pgClient.query(deleteRolesQuery, [guildId, compName]);
                
                        // Delete the composition
                        const deleteCompQuery = `DELETE FROM compositions WHERE discord_id = $1 AND comp_name = $2;`;
                        await pgClient.query(deleteCompQuery, [guildId, compName]);
                
                        return await interaction.reply({ content: `Comp ${compName} has been deleted`, ephemeral: true });
                    } catch (error) {
                        logger.error('Error deleting composition:', error);
                        return await interaction.reply({ content: 'There was an error deleting the composition.', ephemeral: true });
                    }
                }                
                // Handle the /ctabot newcomp command
                if (subCommand === 'newcomp') {
                    const compName = options.getString('compname');
                    const rolesString = options.getString('comproles');
                    if (rolesString.length > 1600) {
                        return await interaction.reply({ content: `Composition shouldn't be longer than 1600 symbols. If you really need it, consider splitting list in two or more comps.`, ephemeral: true });
                    }                
                    const rolesArray = rolesString.split(';').map(role => role.trim());
                    const parties = {};
                    // Split roles into parties of maximum 20
                    for (let i = 0; i < rolesArray.length; i++) {
                        const partyIndex = Math.floor(i / 20);
                        if (!parties[`Party ${partyIndex + 1}`]) {
                            parties[`Party ${partyIndex + 1}`] = {};
                        }
                        parties[`Party ${partyIndex + 1}`][i + 1] = rolesArray[i]; // Role ID is index + 1
                    }          
                    // Check if the composition already exists in the database
                    const existingCompQuery = `SELECT * FROM compositions WHERE discord_id = $1 AND comp_name = $2`;
                    const { rows: existingCompRows } = await pgClient.query(existingCompQuery, [guildId, compName]);
                
                    if (existingCompRows.length > 0 ) {
                        // Composition exists, send a reply
                        return await interaction.reply({ content: `Composition "${compName}" already exists.`, ephemeral: true });
                    } 
                    try {
                        // Start a transaction to insert the composition and its roles
                        await pgClient.query('BEGIN');
                        // Insert composition into the compositions table
                        const insertCompQuery = `
                            INSERT INTO compositions (discord_id, comp_name, owner)
                            VALUES ($1, $2, $3)
                            ON CONFLICT (discord_id, comp_name) 
                            DO UPDATE SET comp_name = $2;
                        `;
                        await pgClient.query(insertCompQuery, [guildId, compName, userId]);
                        // Insert roles into the roles table
                        for (const partyName in parties) {
                            const partyRoles = parties[partyName];
                            for (const roleId in partyRoles) {
                                const role = partyRoles[roleId];
                                const insertRoleQuery = `
                                    INSERT INTO roles (discord_id, comp_name, party, role_id, role_name)
                                    VALUES ($1, $2, $3, $4, $5);
                                `;
                                await pgClient.query(insertRoleQuery, [guildId, compName, partyName, roleId, role]);
                            }
                        }
                
                        // Commit the transaction
                        await pgClient.query('COMMIT');
                        // Send a success message
                        response = `Composition "${compName}" created and stored in the database!`;

                    } catch (error) {
                        // Rollback in case of error
                        await pgClient.query('ROLLBACK');
                        logger.error('Error inserting composition into DB:', error.stack);
                        response = 'There was an error processing the composition. Please try again later.';
                    }
                    return await interaction.reply({ content: response, ephemeral: true });
                }
                
                // Handle the /listcomps command
                if (subCommand === 'listcomps') {
                    const compName = options.getString('compname');
                    let response = '';                
                    // Check if a composition name is provided
                    if (compName) {
                        try {
                            const query = `SELECT roles.party, roles.role_name
                                           FROM compositions
                                           INNER JOIN roles ON compositions.comp_name = roles.comp_name AND compositions.discord_id = roles.discord_id
                                           WHERE compositions.discord_id = $1 AND compositions.comp_name = $2
                                           ORDER BY roles.party, roles.role_id;`;
                            const values = [guildId, compName];
                            const res = await pgClient.query(query, values);
                
                            if (res.rows.length > 0) {
                                response += `Roles in composition "${compName}":\n`;
                                for (const row of res.rows) {
                                    response += `${row.role_name}; `;
                                }
                            } else {
                                response = `Composition "${compName}" does not exist.`;
                            }
                        } catch (error) {
                            logger.error('Error fetching composition:', error);
                            response = 'There was an error fetching the composition.';
                        }
                    } else {
                        try {
                            const query = `SELECT comp_name FROM compositions WHERE discord_id = $1 ORDER BY comp_name;`;
                            const values = [guildId];
                            const res = await pgClient.query(query, values);
                
                            if (res.rows.length > 0) {
                                response += 'Available compositions:\n';
                                for (const row of res.rows) {
                                    response += `${row.comp_name}\n`;
                                }
                            } else {
                                response = 'No compositions found.';
                            }
                        } catch (error) {
                            logger.error('Error fetching compositions:', error);
                            response = 'There was an error fetching the compositions.';
                        }
                    }
                    // Send the response to the user
                    await interaction.reply({ content: response, ephemeral: true });
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
        systemlog.critical(error, error.stack);
    }
})();


// Gracefully disconnect from the database on bot shutdown
process.on('SIGINT', async () => {
    systemlog.info('Bot is shutting down...');
    await disconnectDb(); // Disconnect from the database
    process.exit(0); // Exit the process gracefully
});

process.on('SIGTERM', async () => {
    systemlog.info('Bot is terminating...');
    await disconnectDb(); // Disconnect from the database
    process.exit(0); // Exit the process gracefully
});