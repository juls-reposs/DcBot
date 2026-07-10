import 'dotenv/config';
import http from 'http';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import axios from 'axios';

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = '!';
const MAX_MEMORY = 5;

const messageMemory = new Map();

const userMessageCache = new Map();

client.once('ready', () => {
  console.log(`✓ bot logged in as ${client.user.tag}`);
  client.user.setActivity('your replies | !help', { type: 'LISTENING' });
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;

    trackMessage(message);

    if (message.channel.isDMBased()) {
      if (message.content.startsWith(PREFIX)) {
        await handleCommand(message);
      } else {
        await handleAIResponse(message);
      }
      return;
    }

    const isMentioned = message.mentions.has(client.user);
    const isReply = message.reference !== null;

    if (message.content.startsWith(PREFIX)) {
      await handleCommand(message);
    } else if (isMentioned || isReply) {
      if (isReply) {
        try {
          const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
          if (repliedTo.author.id === client.user.id) {
            await handleAIResponse(message);
          }
        } catch (err) {
        }
      } else if (isMentioned) {
        await handleAIResponse(message);
      }
    }
  } catch (err) {
    console.error('error in messageCreate:', err);
  }
});

async function handleAIResponse(message) {
  try {
    await message.channel.sendTyping();

    const context = getMessageContext(message.author.id);
    const userMessage = message.content
      .replace(`<@${client.user.id}>`, '')
      .replace(`<@!${client.user.id}>`, '')
      .trim();

    const aiResponse = await getAIResponse(userMessage, context);

    if (aiResponse.length > 2000) {
      const chunks = aiResponse.match(/[\s\S]{1,2000}/g) || [];
      for (const chunk of chunks) {
        await message.reply({ content: chunk, allowedMentions: { repliedUser: false } });
      }
    } else {
      await message.reply({ content: aiResponse, allowedMentions: { repliedUser: false } });
    }
  } catch (err) {
    console.error('error getting ai response:', err);
    await message.reply({
      content: 'something broke lol (AI HTTP ERROR)',
      allowedMentions: { repliedUser: false },
    });
  }
}

async function handleCommand(message) {
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args[0]?.toLowerCase();

  try {
    switch (command) {
      case 'dm':
        await cmdDM(message, args);
        break;
      case 'rm':
        await cmdRM(message, args);
        break;
      case 'edit':
        await cmdEdit(message, args);
        break;
      case 'clear':
        await cmdClear(message);
        break;
      case 'help':
        await cmdHelp(message);
        break;
      default:
        await message.reply({
          content: `unknown command. use \`${PREFIX}help\` to see available commands`,
          allowedMentions: { repliedUser: false },
        });
    }
  } catch (err) {
    console.error('error handling command:', err);
    await message.reply({
      content: 'error executing command',
      allowedMentions: { repliedUser: false },
    });
  }
}

async function cmdDM(message, args) {
  if (args.length < 3) {
    await message.reply({
      content: `usage: \`${PREFIX}dm <userid> <message>\``,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const userId = args[1];
  const messageContent = args.slice(2).join(' ');

  try {
    const user = await client.users.fetch(userId);
    const sentMessage = await user.send(messageContent);
    
    if (!userMessageCache.has(userId)) {
      userMessageCache.set(userId, {});
    }
    userMessageCache.get(userId)[sentMessage.id] = {
      content: messageContent,
      sentBy: message.author.id,
      channelId: sentMessage.channelId,
    };

    await message.reply({
      content: `dm sent to ${user.tag}`,
      allowedMentions: { repliedUser: false },
    });
  } catch (err) {
    await message.reply({
      content: `couldnt find user or send dm`,
      allowedMentions: { repliedUser: false },
    });
  }
}

async function cmdRM(message, args) {
  if (args.length < 3) {
    await message.reply({
      content: `usage: \`${PREFIX}rm <userid> <messageid>\``,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const userId = args[1];
  const messageId = args[2];

  try {
    if (!userMessageCache.has(userId) || !userMessageCache.get(userId)[messageId]) {
      await message.reply({
        content: `couldnt find that message`,
        allowedMentions: { repliedUser: false },
      });
      return;
    }

    const cachedMsg = userMessageCache.get(userId)[messageId];

    if (cachedMsg.sentBy !== message.author.id) {
      await message.reply({
        content: `only the sender can delete this message`,
        allowedMentions: { repliedUser: false },
      });
      return;
    }

    const dmChannel = await client.channels.fetch(cachedMsg.channelId);
    const msg = await dmChannel.messages.fetch(messageId);
    await msg.delete();

    delete userMessageCache.get(userId)[messageId];

    await message.reply({
      content: `✓ message deleted`,
      allowedMentions: { repliedUser: false },
    });
  } catch (err) {
    await message.reply({
      content: `couldnt delete message`,
      allowedMentions: { repliedUser: false },
    });
  }
}

async function cmdEdit(message, args) {
  if (args.length < 4) {
    await message.reply({
      content: `usage: \`${PREFIX}edit <userid> <messageid> <newmessage>\``,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const userId = args[1];
  const messageId = args[2];
  const newContent = args.slice(3).join(' ');

  try {
    if (!userMessageCache.has(userId) || !userMessageCache.get(userId)[messageId]) {
      await message.reply({
        content: `couldnt find that message`,
        allowedMentions: { repliedUser: false },
      });
      return;
    }

    const cachedMsg = userMessageCache.get(userId)[messageId];

    if (cachedMsg.sentBy !== message.author.id) {
      await message.reply({
        content: `only the sender can edit this message`,
        allowedMentions: { repliedUser: false },
      });
      return;
    }

    const dmChannel = await client.channels.fetch(cachedMsg.channelId);
    const msg = await dmChannel.messages.fetch(messageId);
    await msg.edit(newContent);

    userMessageCache.get(userId)[messageId].content = newContent;

    await message.reply({
      content: `✓ message edited`,
      allowedMentions: { repliedUser: false },
    });
  } catch (err) {
    await message.reply({
      content: `couldnt edit message`,
      allowedMentions: { repliedUser: false },
    });
  }
}

async function cmdClear(message) {
  try {
    messageMemory.delete(message.author.id);
    await message.reply({
      content: `lawliet memory bye bye`,
      allowedMentions: { repliedUser: false },
    });
  } catch (err) {
    await message.reply({
      content: `couldnt clear memory`,
      allowedMentions: { repliedUser: false },
    });
  }
}

async function cmdHelp(message) {
  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle('commands')
    .addFields(
      {
        name: `${PREFIX}dm <userid> <message>`,
        value: 'send a dm to someone',
        inline: false,
      },
      {
        name: `${PREFIX}rm <userid> <messageid>`,
        value: 'delete a dm you sent',
        inline: false,
      },
      {
        name: `${PREFIX}edit <userid> <messageid> <newmessage>`,
        value: 'edit a dm you sent',
        inline: false,
      },
      {
        name: `${PREFIX}clear`,
        value: 'clear your ai conversation memory',
        inline: false,
      },
      {
        name: 'mention or reply to bot',
        value: 'ask the bot something and itll respond with ai',
        inline: false,
      },
      {
        name: 'dm the bot',
        value: 'dm the bot directly to chat',
        inline: false,
      }
    );

  await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
}

function trackMessage(message) {
  if (!messageMemory.has(message.author.id)) {
    messageMemory.set(message.author.id, []);
  }

  const memory = messageMemory.get(message.author.id);
  memory.push({
    content: message.content,
    author: message.author.username,
    timestamp: Date.now(),
  });

  if (memory.length > MAX_MEMORY) {
    memory.shift();
  }
}

function getMessageContext(userId) {
  const memory = messageMemory.get(userId) || [];
  return memory.map((msg) => `${msg.author}: ${msg.content}`).join('\n');
}

async function getAIResponse(userMessage, context) {
  try {
    const history = [];
    history.push({
      role: 'system',
      content: 'You are a helpful assistant. Reply in a concise, casual Gen-Z style when appropriate. use filler words like 'fr', 'ngl', 'lowk', 'highk', 'ong', 'bet', 'fr'',
    });

    if (context) {
      const lines = context.split('\n').filter(Boolean).slice(-3);
      for (const line of lines) {
        history.push({ role: 'user', content: line });
      }
    }

    history.push({ role: 'user', content: userMessage });

    const payload = {
      system: 'You are a helpful assistant. Reply in a concise, casual Gen-Z style when appropriate.',
      history: [
        ...history,
        { role: 'user', content: userMessage }
      ],
    };

    const response = await axios.post(process.env.AI_PROXY, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });

    let aiText =
      response.data?.response ||
      response.data?.message ||
      response.data?.text ||
      'i have no idea what ur talking about fr';

    aiText = makeGenZ(aiText);

    return aiText;
  } catch (err) {
    console.error('ai api error:', err.response?.status, err.response?.data || err.message);
    throw err;
  }
}

function makeGenZ(text) {
  text = text.replace(/\.{2,}/g, '.');
  text = text.replace(/!{2,}/g, '!');
  text = text.replace(/\?{2,}/g, '?'); 

  if (Math.random() > 0.5) {
    text = text.replace(/\.+$/, '');
  }

  const fillers = ['fr', 'ngl', 'lowk', 'highk', 'ong', 'bet', 'fr'];
  if (Math.random() > 0.6) {
    const filler = fillers[Math.floor(Math.random() * fillers.length)];
    text = text + ` ${filler}`;
  }

  return text;
}

client.login(process.env.DISCORD_TOKEN);
