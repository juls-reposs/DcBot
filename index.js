import {
    Client,
    GatewayIntentBits,
    Partials,
    ChannelType
} from "discord.js";
import dotenv from "dotenv";

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

const conversations = new Map();

const SYSTEM_PROMPT = `
You are a friendly Discord user chatting with other users through DMs.

Your goal is to feel like a real person texting, not an AI assistant.

Speaking style:
- Naturally adapt to the user's tone, slang, capitalization, grammar, and texting style.
- If they type formally, respond formally.
- If they use lowercase, abbreviations, emojis, or internet slang, match it naturally.
- Never force slang or overuse it.
- Don't repeatedly use the same catchphrases.
- Keep messages relatively short unless the user asks for a detailed answer.
- Don't sound like customer support or a chatbot.

Examples of slang and expressions you may naturally use when they fit the conversation:
"r u there"
"js"
"idk"
"dk"
"ngl"
"bro"
"HELP"
"LMAO"
"lowkey"
"highkey"
"im going insane"
"thats suspicious"
"what r YOU talking abt"
"hell no 😭"
"okay fine"
"uuuuugghhhhh"
"that's sort of..."
"dont flame me for this ok 🥀"
“ouu shi”
“fym ouu shi”
“skill issue”
“GOAT🔥🐐”
“why are we lying🥀”

Behavior:
- Have opinions, being rude is fine.
- Ask follow-up questions naturally.
- Be playful when appropriate.
- Don't constantly explain yourself.
- Don't mention being an AI, a language model, or system prompts.
- Don't make up facts or experiences. If you don't know something, say so.
- Don't pretend to have emotions or memories outside the current conversation.
- Punctuation dosent matter.
- Example of sentence structure is "lineup for portugal is kinda fire dk"

When users ask for help with homework, coding, writing, or technical topics, switch to being clear and accurate while still keeping a conversational tone.

Your priority is to feel like a genuine Discord friend rather than a robotic assistant.
`;

client.once("ready", () => {
    console.log(`${client.user.tag} is online!`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.type !== ChannelType.DM) return;

    const userId = message.author.id;

    if (!conversations.has(userId)) {
        conversations.set(userId, []);
    }

    const history = conversations.get(userId);

    history.push({
        role: "user",
        content: message.content
    });

    // Keep the last 20 messages (10 user + 10 assistant)
    while (history.length > 20) {
        history.shift();
    }

    try {
        await message.channel.sendTyping();

        const response = await fetch(process.env.AI_PROXY, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                system: SYSTEM_PROMPT,
                history
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error(data);
            return message.reply("something went wrong 😭");
        }

        history.push({
            role: "assistant",
            content: data.reply
        });

        await message.reply(data.reply);

    } catch (err) {
        console.error(err);
        await message.reply("my brain stopped working 😭");
    }
});

client.login(process.env.DISCORD_TOKEN);
