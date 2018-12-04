require('dotenv').config()

const Sequelize = require('sequelize');
const sequelize = new Sequelize('database', null, null, {
  dialect: 'sqlite',
  storage: 'db/database.sqlite',
  operatorsAliases: false
});

const Bridge = sequelize.define('bridges', {
  slack_channel_id: Sequelize.STRING,
  zulip_stream: Sequelize.STRING,
  zulip_topic: Sequelize.STRING,
});

sequelize.sync();

const { RTMClient } = require('@slack/client');
const { WebClient } = require('@slack/client');

const token = process.env.SLACK_TOKEN;

const zulip = require('zulip-js');
const path = require('path');
const zuliprc = path.resolve(__dirname, 'zuliprc');

/**
 * Start event loop for zulip api
 * @param {*} zulipApi
 * @param {*} web
 */
async function runZulip(zulipApi, web) {
    //Register a queue for receiving messages event on all public streams
    let params = {
        event_types: ['message'],
        all_public_streams: "true"
    };
    let queue = await zulipApi.queues.register(params);
    
    params = {
        queue_id: queue.queue_id,
        last_event_id: -1,
        dont_block: false,
    };
    while (1) { //loop on events.retrieve
        let events = await zulipApi.events.retrieve(params);
    
        events.events.forEach(async e => {
            //Ignore heartbeat events
            if (e.type === "heartbeat")
                return;
            //Ignore our own events
            if (e.message.sender_email === "slack-bridge-bot@zulip.superbiche.co")
                return;
            forwardToSlack(web, e.message);
        });
        //Pass the last event id we received to ack previous ones
        params.last_event_id = events.events[events.events.length - 1].id;
    }
}

/**
 * Forwards a slack message to zulip
 * Return a boolean reflecting the success
 * 
 * @param {zulip API} zulipApi
 * @param {slack.message} slackMessage
 * @returns bool
 */
async function forwardToZulip(zulipApi, slackMessage) {
    let b = await Bridge.findOne({
        where: { slack_channel_id: slackMessage.channel }
    });
    if (b) {
        if (slackMessage.files) {
            slackMessage.files.forEach(async f => {
                await zulipApi.messages.send({
                    to: b.zulip_stream,
                    type: 'stream',
                    subject: b.zulip_topic,
                    content: `[${f.name}](${f.url_private})`,
                });
            });
        }
        let message = await zulipApi.messages.send({
            to: b.zulip_stream,
            type: 'stream',
            subject: b.zulip_topic,
            content: slackMessage.text,
        });
        console.log(`A message was forwaded to zulip : ${b.zulip_channel_id} (channel:${slackMessage.channel}) ${slackMessage.user} says: ${slackMessage.text}`);
        return true;
    }
    return false;
}

/**
 * Start listening for slack message events
 *
 * @param {*} zulipApi
 * @param {*} rtm
 * @param {*} web
 */
async function runSlack(zulipApi, rtm, web) {
    rtm.on('message', async (message) => {
        // Ignore messages with a subtype && comming from this bot
        if ( (message.subtype) ||
             (!message.subtype && message.user === rtm.activeUserId) ) {
          return;
        }

        if (message.text && message.text.startsWith("zulip/link ")) { //Handle the link command
            let channel = message.text.replace("zulip/link ", "").split(":"); 

            if (channel.length > 0) {
                let stream = channel[0];
                let topic = "";
                if (channel.length == 2)
                    topic = channel[1];

                let b = await Bridge.create({
                    slack_channel_id: message.channel,
                    zulip_stream: stream,
                    zulip_topic: topic
                });

                console.log("Created bridge : ", b);
                //Send acknoledgements on both channels
                await web.chat.postMessage({ channel: message.channel,
                    text: "Linked this channel to " + channel.join(":") + " on zulip",
                    thread_ts: message.ts});
                await zulipApi.messages.send({
                    to: stream,
                    type: 'stream',
                    subject: topic,
                    content: "This channel was linked the " + message.channel + " channel on slack",
                });
            } else {
                await web.chat.postMessage({ channel: message.channel,
                    text: "Error linking channel, please try again",
                    thread_ts: message.ts});
            }
            return;
        }

        if (message.text && message.text.startsWith("zulip/unlink")) { //Handle the link command
            await Bridge.destroy({where: {slack_channel_id: message.channel}});
            
            await web.chat.postMessage({channel: message.channel,
                text: "Deleted bridges for this channel",
                thread_ts: message.ts});
            return;
        }

        await forwardToZulip(zulipApi, message);
    });
}

/**
 * Forward a zulip message to slack
 *
 * @param {*} web
 * @param {*} zulipMessage
 * @returns
 */
async function forwardToSlack(web, zulipMessage) {
    let b = await Bridge.findOne({
        where: { 
            zulip_stream: zulipMessage.display_recipient,
            zulip_topic: zulipMessage.subject    
        }
    });
    if (b) {
        web.chat.postMessage({ channel: b.slack_channel_id, text: zulipMessage.content});
        console.log(`A message was forwaded to slack : ${b.slack_channel_id} (channel:${zulipMessage.display_recipient}) ${zulipMessage.sender_short_name} says: ${zulipMessage.content}`);
        return true;
    }
    return false;
}

async function run() {
    const rtm = new RTMClient(token);
    rtm.start();
    const web = new WebClient(token);

    let zulipApi = await zulip({zuliprc});

    runZulip(zulipApi, web);
    runSlack(zulipApi, rtm, web);
}

run();