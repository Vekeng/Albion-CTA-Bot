import { logger } from './winston.js';
import { combineDateAndTime } from './functions.js';
import { pgClient } from './postgres.js'
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, GatewayIntentBits, Events, StringSelectMenuBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';

class CompsManager {
    static async getComps(guildId) {
        let message;
        let comps;  
        try {
            const getComps = `SELECT comp_name FROM compositions WHERE discord_id = $1 ORDER BY comp_name;`;
            comps = await pgClient.query(getComps, [guildId]);
        } catch (error) {
            logger.logWithContext('error', `Error fetching compositions: ${error}`);
            return {error: true, message: `Internal system error. Please contact the developer in https://discord.gg/tyaArtpytv`};
        }
        if (comps.rows.length > 0) {
            message += 'Available compositions:\n';
            for (const row of comps.rows) {
                message += `${row.comp_name}\n`;
            }
        } else {
            return {error: false, message: 'No comps found'}
        }
        return {error: false, message: message}
    }
    static async getCompRoles(compName, guildId) {
        let roles;
        let response; 
        try {
            const getCompRoles = `SELECT roles.party, roles.role_name
                           FROM compositions
                           INNER JOIN roles ON compositions.comp_name = roles.comp_name AND compositions.discord_id = roles.discord_id
                           WHERE compositions.discord_id = $1 AND compositions.comp_name = $2
                           ORDER BY roles.party, roles.role_id;`;
            roles = await pgClient.query(getCompRoles, [guildId, compName]);
        } catch (error) {
            logger.logWithContext('error',`Error fetching composition: ${error}`);
            return {error: true, message: `Internal system error. Please contact the developer in https://discord.gg/tyaArtpytv`};
        }
        if (roles.rows.length > 0) {
            response += `Roles in composition "${compName}":\n`;
            for (const row of roles.rows) {
                response += `${row.role_name};`;
            }
        } else {
            return {error: true, message: `Composition "${compName}" does not exist.`};
        }
        return {error: false, message: response};
    }
    
    static async newComp(compName, compRoles, guildId, userId) {
        const rolesArray = compRoles.split(';').map(role => role.trim());
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
        let comp;
        let message; 
        comp = await getCompByName(compName, guildId);
        if (comp.error) {
            return comp; 
        }
        if (comp.length > 0 ) {
            // Composition exists
            return {error: true, message: `Composition ${compName} already exists`};
        } 
        try {
            // Start a transaction to insert the composition and its roles
            await pgClient.query('BEGIN');
            // Insert composition into the compositions table
            const insertComp = `
                INSERT INTO compositions (discord_id, comp_name, owner)
                VALUES ($1, $2, $3)
                ON CONFLICT (discord_id, comp_name) 
                DO UPDATE SET comp_name = $2;
            `;
            await pgClient.query(insertComp, [guildId, compName, userId]);
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
            message = {error: false, message: `Composition "${compName}" created and stored in the database!`};
        } catch (error) {
            // Rollback in case of error
            await pgClient.query('ROLLBACK');
            logger.logWithContext('error',`Error inserting composition into DB: ${error.stack}`);
            message = {error: true, message: `Internal system error. Please contact the developer in https://discord.gg/tyaArtpytv`};
        }
        return message       
    }

    static async getCompByName(compName, guildId) {
        let comp;
        try {
            const checkComp = `SELECT * FROM compositions WHERE discord_id = $1 AND comp_name = $2`;
            comp = await pgClient.query(checkComp, [guildId, compName]);
        } catch (error) {
            logger.logWithContext('error', `Error when getting composition ${compName}: ${error}`);
            return {error: true, message: `Internal system error. Please contact the developer in https://discord.gg/tyaArtpytv`};
        }
        return comp.rows;
    }

    static async deleteComp(compName, guildId, userId, hasRole) {
        const comp = await this.getCompByName(compName, guildId); 
        let message;
        if (comp.error) {
            return comp; 
        }
        if (comp.length === 0) {
            return {error: true, message: `Comp ${compName} doesn't exist`};
        }
        if (comp[0].owner !== userId || !hasRole) {
            return {error: true, message: `Only composition owner or user with CTABot Admin role can edit this`};
        }
        try {
            await pgClient.query('BEGIN');
            // Delete roles associated with this composition
            const deleteRoles = `DELETE FROM roles WHERE comp_name = (SELECT comp_name FROM compositions WHERE discord_id = $1 AND comp_name = $2);`;
            await pgClient.query(deleteRoles, [guildId, compName]);
    
            // Delete the composition
            const deleteComp = `DELETE FROM compositions WHERE discord_id = $1 AND comp_name = $2;`;
            await pgClient.query(deleteComp, [guildId, compName]);
            await pgClient.query('COMMIT');
            message = {error: false, message: `Comp ${compName} has been deleted`};
        } catch (error) {
            logger.logWithContext(`Error deleting composition ${compName}: ${error}`);
            message = {error: true, message: `Internal system error. Please contact the developer in https://discord.gg/tyaArtpytv`}
        }
        return message;
    }
}

export {CompsManager};