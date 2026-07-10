require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = '!';
const MAX_MEMORY = 20;

// message memory: { userId: [{ content, author, timestamp }] }
const messageMemory = new Map();

// user message cache for dm/edit/rm commands: { userId: { messageId: { content, sentBy, channelId } } }
const userMessageCache = new Map();

client.once('ready', () => {
  console.log(`✓ bot logged in as ${client.user.tag}`);
  client.user.setActivity('your replies | !help', { type: 'LISTENING' });
});

client.on('messageCreate', async (message) => {
  try {
    // ignore bot's own messages
    if (message.author.bot) return;

    // track message in memory
    trackMessage(message);

    // handle DMs
    if (message.channel.isDMBased()) {
      if (message.content.startsWith(PREFIX)) {
        await handleCommand(message);
      } else {
        await handleAIResponse(message);
      }
      return;
    }

    // handle server messages
    const isMentioned = message.mentions.has(client.user);
    const isReply = message.reference !== null;

    if (message.content.startsWith(PREFIX)) {
      await handleCommand(message);
    } else if (isMentioned || isReply) {
      // check if replying to bot
      if (isReply) {
        try {
          const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
          if (repliedTo.author.id === client.user.id) {
            await handleAIResponse(message);
          }
        } catch (err) {
          // couldnt fetch replied message, ignore
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
    const typing = await message.channel.sendTyping();

    // get last 20 messages for context (excluding commands)
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
      content: 'bro something broke lmao',
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

    // cache the message
    if (!userMessageCache.has(userId)) {
      userMessageCache.set(userId, {});
    }
    userMessageCache.get(userId)[sentMessage.id] = {
      content: messageContent,
      sentBy: message.author.id,
      channelId: sentMessage.channelId,
    };

    await message.reply({
      content: `✓ dm sent to ${user.tag}`,
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

    // check if sender is the one who sent the command
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

    // check if sender is the one who sent the command
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

    // update cache
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

  // keep only last 20 messages
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
    const response = await axios.post(process.env.AI_PROXY, {
      message: userMessage,
      context: context || 'new conversation',
    });

    let aiText = response.data.response || response.data.message || 'i have no idea what ur talking about fr';

    // make it gen z style - remove excessive punctuation, add casual language
    aiText = makeGenZ(aiText);

    return aiText;
  } catch (err) {
    console.error('ai api error:', err.message);
    throw err;
  }
}

function makeGenZ(text) {
  // remove excessive punctuation
  text = text.replace(/\.{2,}/g, '.'); // multiple periods to one
  text = text.replace(/!{2,}/g, '!'); // multiple exclamation to one
  text = text.replace(/\?{2,}/g, '?'); // multiple question marks to one

  // randomly remove some punctuation at the end
  if (Math.random() > 0.5) {
    text = text.replace(/\.+$/, '');
  }

  // add casual gen z filler words occasionally
  const fillers = ['fr', 'ngl', 'lowkey', 'highkey', 'no cap', 'bet', 'frfr'];
  if (Math.random() > 0.6) {
    const filler = fillers[Math.floor(Math.random() * fillers.length)];
    text = text + ` ${filler}`;
  }

  return text;
}

client.login(process.env.DISCORD_TOKEN);
