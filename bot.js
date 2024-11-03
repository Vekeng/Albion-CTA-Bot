const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const dotenv = require('dotenv');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');

// Load environment variables
dotenv.config();

// Command definitions
const commands = [
    {
        name: 'newcta',
        description: 'Create a new event post with specified details.',
        options: [
            {
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
            },
        ],
    },
    {
        name: 'join',
        description: 'Join a role for the event.',
        options: [
            {
                name: 'roleid',
                type: 4, // INTEGER
                description: 'The role ID to join',
                required: true,
            },
        ],
    },
    {
        name: 'leave',
        description: 'Leave the current role you are assigned to.',
    },
    {
        name: 'newcomp',
        description: 'Create a new composition with roles.',
        options: [
            {
                name: 'compname',
                type: 3, // STRING
                description: 'Name of the composition',
                required: true,
            },
            {
                name: 'roles',
                type: 3, // STRING
                description: 'List of roles (comma-separated)',
                required: true,
            },
        ],
    },
    {
	    name: 'ctabothelp',
	    description: 'How to use CTA BOT'
    },
    {
        name: 'listcomps',
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
];

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
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
        });

        // Load roles from roles.json
        const rolesPath = 'json/roles.json';
        let roles = {};
        if (fs.existsSync(rolesPath)) {
            roles = JSON.parse(fs.readFileSync(rolesPath, 'utf-8'));
        }

        let eventData = {};

        // Load persistent data
	const botDataPath = 'json/botData.json';
        if (fs.existsSync(botDataPath)) {
            eventData = JSON.parse(fs.readFileSync(botDataPath, 'utf-8'));
        }

        client.once(Events.ClientReady, () => {
            console.log(`Bot has logged in as ${client.user.tag}`);
        });

        client.on(Events.InteractionCreate, async (interaction) => {
            if (!interaction.isCommand()) return;

            console.log(`Received command: ${interaction.commandName} from ${interaction.user.tag} on server ${interaction.guildId}`);

            const { commandName, options } = interaction;
            const guildId = interaction.guildId; // Get the server ID

            // Ensure roles are organized by guild
            if (!roles[guildId]) {
                roles[guildId] = {};
            }

            // Handle the /newcta command
            if (commandName === 'newcta') {
                const eventName = options.getString('eventname');
                const date = options.getString('date');
                const timeUTC = options.getString('time');
                const compName = options.getString('comp');

                if (!roles[guildId][compName]) {
                    return await interaction.reply({ content: 'Invalid composition name provided.', ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setTitle(eventName)
                    .setDescription(`📅Date: **${date}**\n⏰Time (UTC): **${timeUTC}**`)
                    .setColor('#0099ff');
                // Create parties
                for (const party in roles[guildId][compName]) {
                    let partyRoles = '';
                    for (const [id, roleName] of Object.entries(roles[guildId][compName][party])) {
                        partyRoles += `${id}. ${roleName}`.padEnd(20,' ') + ` - Available\n`;
                    }
                    embed.addFields({ name: `⚔️ ${party}`, value: partyRoles });
                };
                embed.addFields({ name: `Sign up in thread!`, value: `/join RoleID - to get the role\n /leave - to free the role` });

                // Send the embed and create a thread
                const eventMessage = await interaction.channel.send({ embeds: [embed] });
                const thread = await eventMessage.startThread({ name: 'Sign Up', autoArchiveDuration: 60 });

                // Store event details for persistence
                eventData[eventMessage.id] = { eventName, date, timeUTC, compName, participants: {} };
                fs.writeFileSync(botDataPath, JSON.stringify(eventData, null, 2));

                await interaction.reply({ content: `Event created! Sign up in ${thread}.`, ephemeral: true });
            }

            // Handle the /join command
            if (commandName === 'join') {
                const roleId = options.getInteger('roleid');

                if (!interaction.channel.isThread()) {
                    return await interaction.reply({ content: 'This command can only be used in a sign-up thread.', ephemeral: true });
                }

                const eventMessage = await interaction.channel.parent.messages.fetch(interaction.channel.id);
                const eventDetails = eventData[eventMessage.id];

                // Check if the user already has a role
                const userId = interaction.user.id;
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

                // Recreate the embed to show the updated participant status
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
                        partyRoles += `${id}. ${roleName} - ${status}\n`;
                    }
                    embed.addFields({ name: `⚔️ ${party}`, value: partyRoles });
                }

                // Update the original message
                await eventMessage.edit({ embeds: [embed] });
                await interaction.reply({ content: `You have successfully joined role ${roleId}.`, ephemeral: true });
            }

            // Handle the /leave command
            if (commandName === 'leave') {
                const eventMessage = await interaction.channel.parent.messages.fetch(interaction.channel.id);
                const eventDetails = eventData[eventMessage.id];

                const userId = interaction.user.id;
                const roleToFree = Object.keys(eventDetails.participants).find(role => eventDetails.participants[role] === userId);

                if (roleToFree) {
                    // Free the role
                    delete eventDetails.participants[roleToFree];
                    fs.writeFileSync(botDataPath, JSON.stringify(eventData, null, 2));

                    // Recreate the embed to show the updated participant status
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
                            partyRoles += `${id}. ${roleName} - ${status}\n`;
                        }
                        embed.addFields({ name: `⚔️ ${party}`, value: partyRoles });
                    }

                    // Update the original message
                    await eventMessage.edit({ embeds: [embed] });
                    await interaction.reply({ content: `You have successfully left your role.`, ephemeral: true });
                } else {
                    await interaction.reply({ content: 'You are not currently assigned to any role.', ephemeral: true });
                }
            }

            // Handle the /newcomp command
            if (commandName === 'newcomp') {
                const compName = options.getString('compname');
                const rolesString = options.getString('roles');

                const rolesArray = rolesString.split(',').map(role => role.trim());
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
                if (!roles[guildId][compName]) {
                    roles[guildId][compName] = parties;
                    fs.writeFileSync(rolesPath, JSON.stringify(roles, null, 2));
                    await interaction.reply({ content: `Composition "${compName}" created successfully!`, ephemeral: true });
                } else {
                    await interaction.reply({ content: `Composition "${compName}" already exists.`, ephemeral: true });
                }
            }
	    // Handle the /ctabothelp command
	    if (commandName === 'ctabothelp') {
		    response = `**CTABot** is a Discord bot designed for managing Guild events in Albion Online. It helps players create and manage events and track participants. With CTABot, you can easily organize your CTAs, Outposts runs and other content.\n**Available Commands**\n- **/newcta**: Create a new event post with details like event name, date, time, and comp.\n- **/join**: Join a specified role for the event by providing the role ID. Command works only in thread created for event.\n- **/leave**: Leave the current role you are assigned to. Command works only in thread created for event.\n- **/newcomp**: Create a new composition with a list of roles. If list includes more than 20 roles, they will be split in two or more parties.\n- **/listcomps**: List all compositions available or view roles in a specific composition.`;
		    await interaction.reply({content: response, ephemeral: true});
	    }
            // Handle the /listcomps command
            if (commandName === 'listcomps') {
                const compName = options.getString('compname');
                let response = '';

                if (compName) {
                    if (roles[guildId][compName]) {
                        response += `Roles in composition "${compName}":\n`;
                        for (const party in roles[guildId][compName]) {
                            response += `⚔️ ${party}:\n`;
                            for (const [id, roleName] of Object.entries(roles[guildId][compName][party])) {
                                response += `${id}. ${roleName}\n`;
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
        });

        // Log in to Discord
        client.login(process.env.BOT_TOKEN);
    } catch (error) {
        console.error(error);
    }
})();

