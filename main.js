const tmi = require('tmi.js');
const mysql = require('mysql2');
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3002 });
const { default: ollama } = require('ollama');
const fetch = require('node-fetch');
require('dotenv').config();

// BEHOLD MY MESSSY CODE HAHAHAHA


// Configuration from environment variables
const botUsername = process.env.BOT_USERNAME;
const botPassword = process.env.BOT_PASSWORD;
const channelName = process.env.CHANNEL_NAME;
const dbHost = process.env.DB_HOST;
const dbName = process.env.DB_NAME;
const dbUser = process.env.DB_USER;
const dbPassword = process.env.DB_PASSWORD;

// Twitch client setup
const client = new tmi.Client({
    connection: {
        secure: true,
        reconnect: true
    },
    identity: {
        username: botUsername,
        password: botPassword,
    },
    channels: [channelName],
});

// Database connection setup
const db = mysql.createConnection({
    host: dbHost,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    charset: 'UTF8MB4'
});

// Connect to DB
db.connect((err) => {
    if (err) {
        console.error(`[Database] Error connecting to database: ${err}`);
        process.exit(1);
    }
    console.log('[Database] Connected to MySQL database');
});

// Store pending duel requests
const duelRequests = {};

// WebSocket broadcast function
function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// WebSocket server connection notification
wss.on('connection', (ws) => {
    console.log('[WebSocket] Client connected to WebSocket');
    ws.on('close', () => {
        console.log('[WebSocket] WebSocket client disconnected');
    });
});


// Connect to Twitch
client.connect().then(() => {
    console.log(`[Twitch] Connected to channel: ${channelName}`);
}).catch((err) => {
    console.error(`[Twitch] Error connecting to Twitch: ${err}`);
});

// Function to add a new command
function handleAddCommand(channel, tags, message) {
    const isModerator = tags['user-type'] === 'mod' || tags.username.toLowerCase() === "ms_smurf";
    if (!isModerator) {
        client.say(channel, `Only moderators or ms_smurf can add commands.`);
        console.log(`[Command] ${tags.username} tried to add a command but is not a moderator.`);
        return;
    }

    const commandParts = message.split(' ');
    if (commandParts.length < 3) {
        client.say(channel, `Invalid command syntax. Usage: !addcommand [command name] [response message]`);
        console.log(`[Command] Invalid !addcommand syntax from ${tags.username}: ${message}`);
        return;
    }

    const commandName = commandParts[1];
    const responseMessage = commandParts.slice(2).join(' ');

    db.query('INSERT INTO commands (command_name, response_message) VALUES (?, ?)', [commandName, responseMessage], (err) => {
        if (err) {
            console.error(`[Database] Error adding command to database: ${err}`);
            return;
        }
        client.say(channel, `Command "${commandName}" added.`);
        console.log(`[Command] Command "${commandName}" added by ${tags.username}.`);
    });
}

// Function to delete a command
function handleDeleteCommand(channel, tags, message) {
    const isModerator = tags['user-type'] === 'mod' || tags.username.toLowerCase() === "ms_smurf";
    if (!isModerator) {
        client.say(channel, `Only moderators or ms_smurf can delete commands.`);
        console.log(`[Command] ${tags.username} tried to delete a command but is not a moderator.`);
        return;
    }

    const commandParts = message.split(' ');
    if (commandParts.length !== 2) {
        client.say(channel, `Invalid command syntax. Usage: !deletecommand [command name]`);
        console.log(`[Command] Invalid !deletecommand syntax from ${tags.username}: ${message}`);
        return;
    }

    const commandName = commandParts[1];

    db.query('DELETE FROM commands WHERE command_name = ?', [commandName], (err, result) => {
        if (err) {
            console.error(`[Database] Error deleting command from database: ${err}`);
            return;
        }
        if (result.affectedRows > 0) {
            client.say(channel, `Command "${commandName}" deleted.`);
            console.log(`[Command] Command "${commandName}" deleted by ${tags.username}.`);
        } else {
            client.say(channel, `Command "${commandName}" not found.`);
            console.log(`[Command] Command "${commandName}" not found for deletion by ${tags.username}.`);
        }
    });
}

// Function to modify a command
function handleModifyCommand(channel, tags, message) {
    const isModerator = tags['user-type'] === 'mod' || tags.username.toLowerCase() === "ms_smurf";
    if (!isModerator) {
        client.say(channel, `Only moderators or ms_smurf can modify commands.`);
        console.log(`[Command] ${tags.username} tried to modify a command but is not a moderator.`);
        return;
    }

    const commandParts = message.split(' ');
    if (commandParts.length < 3) {
        client.say(channel, `Invalid command syntax. Usage: !modifycommand [command name] [new response message]`);
        console.log(`[Command] Invalid !modifycommand syntax from ${tags.username}: ${message}`);
        return;
    }

    const commandName = commandParts[1];
    const newResponseMessage = commandParts.slice(2).join(' ');

    db.query('UPDATE commands SET response_message = ? WHERE command_name = ?', [newResponseMessage, commandName], (err, result) => {
        if (err) {
            console.error(`[Database] Error modifying command in database: ${err}`);
            return;
        }
        if (result.affectedRows > 0) {
            client.say(channel, `Command "${commandName}" modified.`);
            console.log(`[Command] Command "${commandName}" modified by ${tags.username}.`);
        } else {
            client.say(channel, `Command "${commandName}" not found.`);
            console.log(`[Command] Command "${commandName}" not found for modification by ${tags.username}.`);
        }
    });
}

// !time command
function handleTimeCommand(channel) {
    const date = new Date();
    const time = date.toLocaleTimeString();
    client.say(channel, `The current time is ${time}`);
    console.log(`[Command] !time command executed.`);
}

// !points command
async function handlePointsCommand(channel, tags) {
    try {
        const [result] = await db.promise().query('SELECT userpoints FROM points WHERE twitchuser = ?', [tags.username]);
        if (result.length === 0) {
            await db.promise().query('INSERT INTO points (twitchuser, userpoints) VALUES (?, 0)', [tags.username]);
            client.say(channel, `${tags.username} has 0 points to waste`);
            console.log(`[Points] ${tags.username} checked points for the first time, set to 0.`);
        } else {
            const pointsResponse = result[0].userpoints;
            client.say(channel, `${tags.username} has ${pointsResponse} points to waste`);
            console.log(`[Points] ${tags.username} checked points: ${pointsResponse}`);
        }
    } catch (err) {
        console.error(`[Database] Error retrieving/inserting points: ${err}`);
    }
}

// Function to handle the !work command
async function handleWorkCommand(channel, tags) {
    try {
        let [result] = await db.promise().query('SELECT userpoints FROM points WHERE twitchuser = ?', [tags.username]);
        if (result.length === 0) {
            await db.promise().query('INSERT INTO points (twitchuser, userpoints) VALUES (?, 0)', [tags.username]);
            result = [{ userpoints: 0 }];
            console.log(`[Points] New user ${tags.username} worked for the first time.`);
        }
        const earnedPoints = Math.floor(Math.random() * 10);
        await db.promise().query('UPDATE points SET userpoints = userpoints + ? WHERE twitchuser = ?', [earnedPoints, tags.username]);
        client.say(channel, `${tags.username} has earned ${earnedPoints} extra points to spend from all there hard work`);
        console.log(`[Points] ${tags.username} earned ${earnedPoints} points from !work.`);
    } catch (err) {
        console.error(`[Database] Error processing work command: ${err}`);
    }
}

// Function to !gamble
async function handleGambleCommand(channel, tags, message) {
    const gambleAmountMatch = message.match(/!gamble (\d+)|!gamble all/i);
    if (!gambleAmountMatch) {
        client.say(channel, `${tags.username}, please specify an amount to gamble or use "!gamble all".`);
        console.log(`[Gamble] Invalid !gamble syntax from ${tags.username}: ${message}`);
        return;
    }

    let gambleAmount = gambleAmountMatch[1] ? parseInt(gambleAmountMatch[1]) : 'all';

    try {
        const [result] = await db.promise().query('SELECT userpoints FROM points WHERE twitchuser = ?', [tags.username]);
        if (result.length === 0) {
            client.say(channel, `${tags.username}, you're broke! Go get a job and do some !work.`);
            console.log(`[Gamble] ${tags.username} tried to gamble with 0 points.`);
            return;
        }

        const currentPoints = result[0].userpoints;

        if (gambleAmount === 'all') {
            gambleAmount = currentPoints;
        } else if (gambleAmount > currentPoints) {
            client.say(channel, `${tags.username}, you don't have enough points to gamble that much.`);
            console.log(`[Gamble] ${tags.username} tried to gamble ${gambleAmount} but only has ${currentPoints}.`);
            return;
        }

        const win = Math.random() < 0.5; // 50/50 chance of winning

        if (win) {
            const newPoints = currentPoints + gambleAmount;
            await db.promise().query('UPDATE points SET userpoints = ? WHERE twitchuser = ?', [newPoints, tags.username]);
            client.say(channel, `${tags.username} hit it big and now has ${newPoints} points! Keep gambling!`);
            console.log(`[Gamble] ${tags.username} won ${gambleAmount} points, new total: ${newPoints}.`);
        } else {
            const newPoints = currentPoints - gambleAmount;
            await db.promise().query('UPDATE points SET userpoints = ? WHERE twitchuser = ?', [newPoints, tags.username]);
            client.say(channel, `${tags.username} lost ${gambleAmount} and now has ${newPoints} lmao.`);
            console.log(`[Gamble] ${tags.username} lost ${gambleAmount} points, new total: ${newPoints}.`);
        }
    } catch (err) {
        console.error(`[Database] Error during gambling: ${err}`);
    }
}

// !legend command function
function handleLegendCommand(channel, tags) {
    client.say(channel, `@${tags.username}, the random game legend game has started!!`);
    console.log(`[Command] !legend command initiated by ${tags.username}.`);
    legendGuess(); //calls the helper function for the !legend command
}

// !duel commmand function
async function handleDuelCommand(channel, tags, message) {
    const duelParts = message.split(' ');
    if (duelParts.length !== 3) {
        client.say(channel, `Invalid command syntax. Usage: !duel {target user} {points}`);
        console.log(`[Duel] Invalid !duel syntax from ${tags.username}: ${message}`);
        return;
    }

    const targetUser = duelParts[1].toLowerCase().replace('@', '');
    const amount = parseInt(duelParts[2]);

    if (targetUser === tags.username.toLowerCase()) {
        client.say(channel, `You can't duel yourself so stop trying!`);
        console.log(`[Duel] ${tags.username} tried to duel themselves.`);
        return;
    }

    if (isNaN(amount) || amount <= 0) {
        client.say(channel, `you need to duel with more than 0 points.`);
        console.log(`[Duel] Invalid duel amount from ${tags.username}: ${amount}`);
        return;
    }

    try {
        const [result] = await db.promise().query('SELECT userpoints FROM points WHERE twitchuser = ?', [tags.username]);
        if (result.length === 0 || result[0].userpoints < amount) {
            client.say(channel, `You don't have enough points to duel you bell end!`);
            console.log(`[Duel] ${tags.username} tried to duel with insufficient points.`);
            return;
        }

        duelRequests[targetUser] = {
            challenger: tags.username.toLowerCase(),
            amount: amount
        };

        client.say(channel, `@${targetUser}, @${tags.username} challenges you to a duel for ${amount} points! Type "!accept" to fight.`);
        console.log(`[Duel] ${tags.username} challenged ${targetUser} for ${amount} points.`);
    } catch (err) {
        console.error(`[Database] Error initiating duel: ${err}`);
    }
}

// Function to handle the !accept command
async function handleAcceptCommand(channel, tags) {
    const targetUser = tags.username.toLowerCase();
    const duelRequest = duelRequests[targetUser];

    if (!duelRequest) {
        client.say(channel, `You have no pending duel requests.`);
        console.log(`[Duel] ${tags.username} tried to accept a duel but has no pending requests.`);
        return;
    }

    const { challenger, amount } = duelRequest;
    delete duelRequests[targetUser]; // Remove the request from Queue

    try {
        const [results] = await db.promise().query(
            'SELECT twitchuser, userpoints FROM points WHERE LOWER(twitchuser) IN (?, ?)',
            [challenger.toLowerCase(), targetUser.toLowerCase()]
        );

        const challengerData = results.find(r => r.twitchuser === challenger.toLowerCase());
        const targetData = results.find(r => r.twitchuser === targetUser.toLowerCase());

        const challengerPoints = challengerData?.userpoints || 0;
        const targetPoints = targetData?.userpoints || 0;

        if (challengerPoints < amount || targetPoints < amount) {
            client.say(channel, `One of you doesn't have enough points anymore!`);
            console.log(`[Duel] Duel between ${challenger} and ${targetUser} cancelled due to insufficient points.`);
            return;
        }

        const winner = Math.random() < 0.5 ? challenger : targetUser;
        const loser = winner === challenger ? targetUser : challenger;

        await db.promise().query(
            `UPDATE points
             SET userpoints = CASE
               WHEN twitchuser = ? THEN userpoints - ?
               WHEN twitchuser = ? THEN userpoints + ?
             END
             WHERE twitchuser IN (?, ?)`,
            [loser, amount, winner, amount, loser, winner]
        );

        client.say(channel, `⚔️ @${winner} defeated @${loser} and won ${amount} points, gamb-I meant spend them well!`);
        console.log(`[Duel] ${winner} defeated ${loser} for ${amount} points.`);
    } catch (err) {
        console.error(`[Database] Error accepting duel: ${err}`);
    }
}

// OLLAMA !chatbot command 
async function handleChatbotCommand(channel, tags, message) {
    const userMessage = message.replace('!chatbot', '').trim();
    if (!userMessage) {
        client.say(channel, `@${tags.username}, please ask something like "!chatbot What is your name?"`);
        console.log(`[Chatbot] Empty !chatbot command from ${tags.username}.`);
        return;
    }

    try {
        const response = await fetch("http://localhost:11434/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "smurfbotv1.3",
                prompt: userMessage,
                stream: false
            })
        });

        const data = await response.json();
        client.say(channel, `@${tags.username}, ${data.response}`);
        console.log(`[Chatbot] Question from ${tags.username}: ${userMessage} -> Response: ${data.response}`);
    } catch (error) {
        console.error(`[Chatbot] AI Error: ${error}`);
        client.say(channel, `@${tags.username}, I encountered an error. Try again later.`);
    }
}

// Twitch message events
client.on('message', (channel, tags, message, self) => {
    if (self) return; // Skip processing messages sent by the bot

    if (message.toLowerCase().startsWith('!addcommand')) {
        handleAddCommand(channel, tags, message);
    } else if (message.toLowerCase().startsWith('!deletecommand')) {
        handleDeleteCommand(channel, tags, message);
    } else if (message.toLowerCase().startsWith('!modifycommand')) {
        handleModifyCommand(channel, tags, message);
    } else if (message.startsWith('!time')) {
        handleTimeCommand(channel);
    } else if (message.toLowerCase().startsWith('!points')) {
        handlePointsCommand(channel, tags);
    } else if (message.toLowerCase().startsWith('!work')) {
        handleWorkCommand(channel, tags);
    } else if (message.toLowerCase().startsWith('!gamble')) {
        handleGambleCommand(channel, tags, message);
    } else if (message.toLowerCase().startsWith('!legend')) {
        handleLegendCommand(channel, tags);
    } else if (message.toLowerCase().startsWith('!duel')) {
        handleDuelCommand(channel, tags, message);
    } else if (message.toLowerCase() === '!accept') {
        handleAcceptCommand(channel, tags);
    } else if (message.toLowerCase().startsWith('!chatbot')) {
        handleChatbotCommand(channel, tags, message);
    } else {

        // Retrieve custom commands
        db.query('SELECT response_message FROM commands WHERE command_name = ?', [message], (err, result) => {
            if (err) {
                console.error(`[Database] Error retrieving command response: ${err}`);
                return;
            }
            if (result.length > 0) {
                const responseMessage = result[0].response_message;
                client.say(channel, responseMessage);
                console.log(`[Command] Executed custom command: ${message} -> ${responseMessage}`);
            }
        });
    }
});

// !legend command links
function legendGuess() {
    const videoPaths = [
        'http://192.168.0.41/videos/Alter.mp4', 'http://192.168.0.41/videos/Ash.mp4',
        'http://192.168.0.41/videos/Ballistic.mp4', 'http://192.168.0.41/videos/Bang.mp4',
        'http://192.168.0.41/videos/Blood.mp4', 'http://192.168.0.41/videos/Cat.mp4',
        'http://192.168.0.41/videos/Caustic.mp4', 'http://192.168.0.41/videos/Conduit.mp4',
        'http://192.168.0.41/videos/Crypto.mp4', 'http://192.168.0.41/videos/Fuse.mp4',
        'http://192.168.0.41/videos/Gibby.mp4', 'http://192.168.0.41/videos/Horizon.mp4',
        'http://192.168.0.41/videos/Lifeline.mp4', 'http://192.168.0.41/videos/Loba.mp4',
        'http://192.168.0.41/videos/Maggie.mp4', 'http://192.168.0.41/videos/Mirage.mp4',
        'http://192.168.0.41/videos/NewCastle.mp4', 'http://192.168.0.41/videos/Octane.mp4',
        'http://192.168.0.41/videos/Pathfinder.mp4', 'http://192.168.0.41/videos/Rampart.mp4',
        'http://192.168.0.41/videos/Revenant.mp4', 'http://192.168.0.41/videos/Seer.mp4',
        'http://192.168.0.41/videos/Valk.mp4', 'http://192.168.0.41/videos/Vantage.mp4',
        'http://192.168.0.41/videos/Wattson.mp4', 'http://192.168.0.41/videos/Wraith.mp4',
    ];

    const randomVideo = videoPaths[Math.floor(Math.random() * videoPaths.length)];
    broadcast({ type: 'playVideo', path: randomVideo });
    console.log(`[LegendGame] Sent video path: ${randomVideo}`);
}