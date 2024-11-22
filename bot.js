const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, GatewayIntentBits, Events, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, SlashCommandBuilder, PermissionFlagsBits, ApplicationRoleConnectionMetadata } = require('discord.js');
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const Tesseract = require('tesseract.js');
const dotenv = require('dotenv');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { Console } = require('console');


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
            {
                type: 5, 
                name: 'overwrite',
                description: 'Do you want to overwire comp if it exists? (Use with caution to not overwite comps of other people!)', 
                required: false
            }
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
                description: 'Date of the event',
                required: true,
            },
            {
                name: 'time',
                type: 3, // STRING
                description: 'Time in UTC',
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

async function checkAdminOrOrganizer() {

}

async function getMessage(interaction, messageId) {
    try {
        // Try to fetch the message by its ID
        const message = await interaction.channel.messages.fetch(messageId);
        return message;  // Return message
    } catch (error) {
        if (error.code === 10008) {  // Unknown Message error code
            console.log("Message does not exist.");
            return null;  // Return null
        } else {
            console.error("An error occurred:", error);
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
        console.log("Hours and Minutes");
        // If we matched "X h Y m" format
        hours = parseInt(timeMatchHoursMinutes[1], 10);
        minutes = parseInt(timeMatchHoursMinutes[2], 10);
        console.log(hours, minutes);
        totalSeconds = (hours * 3600) + (minutes * 60); // Convert to seconds
        unixTimeContent = unixTimeNow + totalSeconds;
    } else if (timeMatchMinutesSeconds) {
        console.log("Minutes and Seconds");
        // If we matched "X m Y s" format
        minutes = parseInt(timeMatchMinutesSeconds[1], 10);
        seconds = parseInt(timeMatchMinutesSeconds[2], 10);
        console.log(minutes, seconds);
        totalSeconds = (minutes * 60) + seconds; // Convert to seconds
        unixTimeContent = unixTimeNow + totalSeconds;
    } else if (timeMatchOnlyHours) {
        console.log("Only Hours");
        // If we matched only "X h" format
        hours = parseInt(timeMatchOnlyHours[1], 10);
        totalSeconds = hours * 3600; // Convert to seconds
        unixTimeContent = unixTimeNow + totalSeconds;
    } else if (timeMatchOnlyMinutes) {
        console.log("Only Minutes");
        // If we matched only "X m" format
        minutes = parseInt(timeMatchOnlyMinutes[1], 10);
        totalSeconds = minutes * 60; // Convert to seconds
        unixTimeContent = unixTimeNow + totalSeconds;
    }

    // Return the calculated Unix timestamp
    return unixTimeContent;
}

function buildEventMessage(eventDetails, roles, guildId, eventId) {
    const embed = new EmbedBuilder()
        .setTitle(eventDetails.eventName)
        .setDescription(`Date: **${eventDetails.date}**\nTime (UTC): **${eventDetails.timeUTC}**`)
        .setColor('#0099ff');

    // Create parties and add participant statuses
    for (const party in roles[guildId][eventDetails.compName]) {
        let partyRoles = '';
        for (const [id, roleName] of Object.entries(roles[guildId][eventDetails.compName][party])) {
            const participantId = eventDetails.participants[id];
            const status = participantId ? `<@${participantId}>` : 'Available'; // Format as mention
            if (status === 'Available') {
                partyRoles += `\`🟩\` ${id}. ${roleName}\n`;
            }
            else {
                partyRoles += `\`✔️\` ${id}. ${roleName} - ${status}\n`;
            }
        }
        embed.addFields({ name: `⚔️ ${party}`, value: partyRoles, inline: true });
    }
    embed.setFooter({text: `Event ID: ${eventId}`});
    return embed;
}

const rest = new REST({ version: '9' }).setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
            body: commands,
        });

        console.log('Successfully reloaded application (/) commands.');

        // Start the bot after command registration
        const client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates],
        });

        // Defining CTABot Admin Role in discord
        const guildRoleName = "CTABot Admin";

        // Load roles from roles.json
        const rolesPath = 'json/roles.json';
        let roles = {};
        if (fs.existsSync(rolesPath)) {
            roles = JSON.parse(fs.readFileSync(rolesPath, 'utf-8'));
        }

        //let eventData = {};

        // Load persistent data
	    const botDataPath = 'json/botData.json';
        if (fs.existsSync(botDataPath)) {
            eventData = JSON.parse(fs.readFileSync(botDataPath, 'utf-8'));
        }

        client.once(Events.ClientReady, () => {
            console.log(`Bot has logged in as ${client.user.tag}`);
        });

        client.on(Events.GuildCreate, async (guild) => {
            console.log(`Joined a new guild: ${guild.name}`);
            const existingRole = guild.roles.cache.find(role => role.name === guildRoleName);
            const botMember = guild.members.me;
            if (existingRole) {
                console.log(`Role "${guildRoleName}" already exists.`);
            } else {
                if (botMember.permissions.has('ManageRoles')) {
                    const role = await guild.roles.create({
                        name: guildRoleName,
                        //color: '#0000FF',
                        reason: 'Admin role to control CTABot',
                    });
                    console.log(`Created role "${role.name}" in guild "${guild.name}".`);
                } else {
                    console.log(`Bot lacks permission to manage roles in "${guild.name}".`);
                }
            } 
        });

        client.on(Events.InteractionCreate, async (interaction) => {
            const guildId = interaction.guildId; // Get the server ID
            const userId = interaction.user.id; // Get the User ID
            const member = await interaction.guild.members.fetch(userId);
            const hasRole = member.roles.cache.some(role => role.name === guildRoleName);
            const requiredPermissions = [
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory
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
                // Handle Ping button
                if (interaction.customId.startsWith('ctaping')) {
                    const [action, messageId] = interaction.customId.split('|');
                    const eventMessage = await getMessage(interaction, messageId); 
                    if (!eventMessage) {
                        return await interaction.reply({ content: 'Event no longer exists', ephemeral: true }); 
                    }
                    if (userId != eventData[messageId].userId && !hasRole) {
                        return await interaction.reply({ content: `Pings allowed only to event creator or CTABot Admin role`, ephemeral: true });
                    }
                    const eventDetails = eventData[eventMessage.id];
                    let response = '';
                    let attention = `<@${userId}> calls to arms! 🔔 `;
                    Object.entries(eventDetails.participants).forEach(([key, value]) => {
                        response += `<@${value}> `;
                    });
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
                    if (!eventMessage) {
                        return await interaction.reply({ content: 'Event no longer exists', ephemeral: true }); 
                    } 
                    const eventDetails = eventData[eventMessage.id];
                    const roleToFree = Object.keys(eventDetails.participants).find(role => eventDetails.participants[role] === userId);

                    if (roleToFree) {
                        // Free the role
                        delete eventDetails.participants[roleToFree];
                        fs.writeFileSync(botDataPath, JSON.stringify(eventData, null, 2));
                    }
                    embed = buildEventMessage(eventDetails, roles, guildId, eventMessage.id);
                    await eventMessage.edit({ embeds: [embed] });
                    await interaction.reply({ content: `You have successfully left your role.`, ephemeral: true });
                }
                // Handle Join Button 
                if (interaction.customId.startsWith('joinCTA')) {
                    const [action, messageId, compName] = interaction.customId.split('|');
                    const options = [];
                    for (const party in roles[guildId][compName]) {
                        options.push({
                            label: party, // Display name
                            value: party, // Value to be returned on selection
                          });
                    }
                    if (Object.keys(options).length === 1) {
                        const eventMessage = await getMessage(interaction, messageId); 
                        if (!eventMessage) {
                            return await interaction.update({ content: 'Event no longer exists', ephemeral: true }); 
                        } 
                        const eventDetails = eventData[eventMessage.id];
                        const options = [];
                        party = 'Party 1';
                        for (const [roleId,roleName] of Object.entries(roles[guildId][compName][party])) {
                            if (!eventDetails.participants[roleId]) {
                                options.push({
                                    label: `${roleId}. ${roleName}`, // Display name
                                    value: `${roleId}|${roleName}` // Value to be returned on selection
                                });
                            }
                        }
                        const selectMenu = new StringSelectMenuBuilder()
                            .setCustomId(`joinCTARole|${messageId}|${compName}|${party}`)
                            .setPlaceholder(`Select a role`)
                            .setOptions(options);
                    
                        const row = new ActionRowBuilder().addComponents(selectMenu);
                    
                        return await interaction.reply({
                            content: `Picked ${party}`,
                            components: [row],
                            ephemeral: true
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

                } 
            }
            if (interaction.isStringSelectMenu()) {
                if (interaction.customId.startsWith('joinCTARole')) {
                    const [action, messageId, compName, party] = interaction.customId.split('|');
                    const [roleId, roleName] = interaction.values[0].split('|');
                    const eventMessage = await getMessage(interaction, messageId); 
                    if (!eventMessage) {
                        return await interaction.update({ content: 'Event no longer exists', components: [], ephemeral: true }); 
                    } 
                    const eventDetails = eventData[eventMessage.id];
                    const currentRoleId = Object.keys(eventDetails.participants).find(id => eventDetails.participants[id] === userId);

                    if (currentRoleId) {
                        // Notify user if trying to join the same role
                        if (currentRoleId === roleId.toString()) {
                            return await interaction.reply({ content: 'You are already assigned to this role.', ephemeral: true });
                        }
                        // Free up the previous role
                        delete eventDetails.participants[currentRoleId];
                    }

                    // Check if the requested role is available
                    if (eventDetails.participants[roleId]) {
                        return await interaction.reply({ content: 'This role is already taken by another user.', ephemeral: true });
                    }

                    // Check if the role ID exists in the composition
                    const roleExists = Object.values(roles[guildId][eventDetails.compName]).some(party => party[roleId]);
                    if (!roleExists) {
                        return await interaction.reply({ content: 'This role ID does not exist in the composition.', ephemeral: true });
                    }

                    // Assign the user to the new role
                    eventDetails.participants[roleId] = userId;
                    fs.writeFileSync(botDataPath, JSON.stringify(eventData, null, 2));

                    // Rebuild the event post
                    const embed = buildEventMessage(eventDetails, roles, guildId, eventMessage.id)

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
                    if (!eventMessage) {
                        return await interaction.update({ content: 'Event no longer exists', components: [], ephemeral: true }); 
                    } 
                    const eventDetails = eventData[eventMessage.id];
                    const options = [];
                    for (const [roleId,roleName] of Object.entries(roles[guildId][compName][party])) {
                        if (!eventDetails.participants[roleId]) {
                            options.push({
                                label: `${roleId}. ${roleName}`, // Display name
                                value: `${roleId}|${roleName}` // Value to be returned on selection
                            });
                        }
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

            // Ensure roles are organized by guild
            if (!roles[guildId]) {
                roles[guildId] = {};
            }

            // Handle /ctabot subcommands
            if (commandName === 'ctabot') {
                const subCommand = interaction.options.getSubcommand();
                if (subCommand === 'clearroles')
                {   
                    const messageId = options.getString('eventid');
                    const rolesString = options.getString('roles');
                    const eventMessage = await getMessage(interaction, messageId);
                    if (!eventMessage) {
                        return await interaction.reply({ content: 'Event no longer exists', ephemeral: true }); 
                    }
                    const eventDetails = eventData[eventMessage.id];
                    if (eventMessage && eventData[messageId]  ) {
                        if (userId != eventData[messageId].userId && !hasRole ) {
                            return await interaction.reply({ content: `Freeing roles in the event is allowed only to the organizer of the event or CTABot Admin role`, ephemeral: true });
                        } 
                        const rolesArray = rolesString.split(',').map(role => role.trim());
                        for (let i = 0; i < rolesArray.length; i++) {
                            delete eventDetails.participants[rolesArray[i]];
                            fs.writeFileSync(botDataPath, JSON.stringify(eventData, null, 2));
                        }
                        embed = buildEventMessage(eventDetails, roles, guildId, eventMessage.id);
                        await eventMessage.edit({ embeds: [embed] });
                        await interaction.reply({ content: `Roles ${rolesString} have been cleared.`, ephemeral: true });
                    }
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
                            console.log(text);
                            const allContent = ['Power Vortex', 'A tree with plenty of Tier \\d\\.\\d wood', 'A plant with plenty of Tier \\d\\.\\d fiber',  'Large Treasure Chest', 'A vein with plenty of Tier \\d\\.\\d ore', 'Power Anomaly'];
                            let message = 'Unrecognized content'; // Default message
                            for (const keyword of allContent) {
                                const contentRegex = new RegExp(keyword, 'i');
                                if (contentRegex.test(text)) {
                                    const result = extractKeywordAndTime(text.trim(), keyword);
                                    const match = text.match(contentRegex);
                                    message = `<@${userId}> has found ${match} is <t:${result}:R>!!!`;
                                    console.log(message);
                                    break; // Exit the loop once a match is found
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
                        console.error(error);
                        interaction.editReply({content: 'There was an error processing the image. Please try again.', ephemeral: true});
                        }
                    
                }
                // Clear users not in the Voice Channel from the roles
                if (subCommand === 'prune') {
                    const messageId = options.getString('eventid');
                    const eventMessage = await getMessage(interaction, messageId);
                    if (!eventMessage) {
                        return await interaction.reply({ content: 'Event no longer exists', ephemeral: true }); 
                    }
                    if (userId != eventData[messageId].userId && !hasRole ) {
                        return await interaction.reply({ content: `Freeing roles in the event is allowed only to the organizer of the event or CTABot Admin role`, ephemeral: true });
                    }
                    if (!member.voice.channel) {
                        return interaction.reply({content: 'You are not in a voice channel!', ephemeral: true});
                    }
                    const eventDetails = eventData[eventMessage.id];
                    const participants = eventDetails.participants;
                    const voiceChannel = member.voice.channel;
                    const membersInChannel = voiceChannel.members;
                    const userList = new Set(membersInChannel.map(member => member.user.id)); 
                    const removedUsers = [];
                    for (const roleId in participants) {
                        if (!userList.has(participants[roleId])) {
                            removedUsers.push(`<@${participants[roleId]}>`);
                            delete participants[roleId];
                            fs.writeFileSync(botDataPath, JSON.stringify(eventData, null, 2));
                        }
                    }
                    if (removedUsers.length === 0 ) {
                        return interaction.reply({ content: `Wow! Everyone is in comms!`, ephemeral: true });
                    }
                    embed = buildEventMessage(eventDetails, roles, guildId, eventMessage.id);
                    await eventMessage.edit({ embeds: [embed] });
                    await interaction.reply({ content: `Users ${removedUsers.join(', ')} have been cleared.`, ephemeral: true });
                }

                // Handle /ctabot cancelcta
                if (subCommand === 'cancelcta') {
                    const messageId = options.getString('id');
                    const eventMessage = await getMessage(interaction, messageId); 
                    if (!eventMessage) {
                        return await interaction.reply({ content: 'Event no longer exists', ephemeral: true }); 
                    }
                    if (eventMessage && eventData[messageId] ) {
                        if (userId != eventData[messageId].userId && !hasRole) {
                            return await interaction.reply({ content: `Cancelling events is allowed only to the organizer of the event or CTABot Admin role`, ephemeral: true });
                        }
                        delete eventData[eventMessage];
                        eventMessage.delete();
                        await interaction.reply({ content: `Event ${eventMessage} successfully deleted`, ephemeral: true });
                    } else { await interaction.reply({ content: `Not valid event ID`, ephemeral: true }); }
                }
                // Handle /ctabot newcta
                if (subCommand === 'newcta') {
                    const eventName = options.getString('eventname');
                    const date = options.getString('date');
                    const timeUTC = options.getString('time');
                    const compName = options.getString('comp');
                    const participants = {};
                    const eventDetails  = {
                        eventName, 
                        date, 
                        timeUTC,
                        compName,
                        participants, 
                    };
    
                    if (!roles[guildId][compName]) {
                        return await interaction.reply({ content: 'Invalid composition name provided.', ephemeral: true });
                    }
    
                    embed = buildEventMessage(eventDetails, roles, guildId, "");
    
                    // Send the embed and create a thread
                    const eventMessage = await interaction.reply({ embeds: [embed], fetchReply: true });
    
                    const joinButton = new ButtonBuilder()
                        .setCustomId(`joinCTA|${eventMessage.id}|${compName}`)
                        .setLabel('Join')
                        .setStyle(ButtonStyle.Primary);
    
                    const leaveButton = new ButtonBuilder()
                        .setCustomId(`leaveCTA|${eventMessage.id}`)
                        .setLabel('Leave')
                        .setStyle(ButtonStyle.Danger);

                    const pingButton = new ButtonBuilder()
                        .setCustomId(`ctaping|${eventMessage.id}`)
                        .setLabel('Ping')
                        .setEmoji('⚔️')
                        .setStyle(ButtonStyle.Danger);
    
                    const actionRow = new ActionRowBuilder().addComponents(joinButton, leaveButton, pingButton);
                    embed.setFooter({text: `Event ID: ${eventMessage.id}`});
                    await interaction.editReply({
                        embeds: [embed],
                        components: [actionRow]
                    });
                    eventData[eventMessage.id] = { eventName, userId, date, timeUTC, compName, participants: {} };
                    fs.writeFileSync(botDataPath, JSON.stringify(eventData, null, 2));                
                }
                // Handle the /ctabot newcomp command
                if (subCommand === 'newcomp') {
                    const compName = options.getString('compname');
                    const rolesString = options.getString('comproles');
                    const overwriteParam = options.getBoolean('overwrite')
                    if (rolesString.length > 1600) {
                        await interaction.reply({ content: `Composition shouldn't be longer than 1600 symbols. If you really need it, consider splitting list in two or more comps.`, ephemeral: true });
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
    
                    // Store the new composition
                    if (!roles[guildId][compName] || overwriteParam ) {
                        roles[guildId][compName] = parties;
                        fs.writeFileSync(rolesPath, JSON.stringify(roles, null, 2));
                        if (overwriteParam ) {
                            await interaction.reply({ content: `Composition "${compName}" updated successfully!`, ephemeral: true });
                        } else {
                            await interaction.reply({ content: `Composition "${compName}" created successfully!`, ephemeral: true });
                        }
                    } else {
                        await interaction.reply({ content: `Composition "${compName}" already exists.`, ephemeral: true });
                    }
                }
                // Handle the /listcomps command
                if (subCommand === 'listcomps') {
                    const compName = options.getString('compname');
                    let response = '';

                    if (compName) {
                        if (roles[guildId][compName]) {
                            response += `Roles in composition "${compName}":\n`;
                            for (const party in roles[guildId][compName]) {
                                //response += `⚔️ ${party}:\n`;
                                for (const [id, roleName] of Object.entries(roles[guildId][compName][party])) {
                                    response += `${roleName};`;
                                }
                            }
                        } else {
                            response = `Composition "${compName}" does not exist.`;
                        }
                    } else {
                        response += 'Available compositions:\n';
                        for (const comp in roles[guildId]) {
                            response += `${comp}\n`;
                        }
                    }
                    await interaction.reply({ content: response, ephemeral: true });
                }
                if (subCommand === 'help') {
                    response = `**CTABot** is a Discord bot designed for managing Guild events in Albion Online. It helps players create and manage events and track participants. With CTABot, you can easily organize your CTAs, Outposts runs and other content.\n**Available Commands**\n- **/ctabot newcta**: Create a new event post with details like event name, date, time, and comp.\n- **/ctabot newcomp**: Create a new composition with a list of roles separated by semicolons \`;\`. If list includes more than 20 roles, they will be split in two or more parties. Use force to update existing comp. \n- **/ctabot listcomps**: List all compositions available or view roles in a specific composition.\n- **/ctabot cancelcta** - removed event with specified ID. ID can be found in the bottom of the event post.\n- **/ctabot clearroles** - clears specified list of roles in specific event ID. ID can be found in the bottom of the event post.`;
                    await interaction.reply({content: response, ephemeral: true});
                }              
            }
        });

        // Log in to Discord
        client.login(process.env.BOT_TOKEN);
    } catch (error) {
        console.error(error);
    }
})();