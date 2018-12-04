# Zulip Slack Sync

## Description

This project aims at creating a bridge between a Slack workspace and a Zulip instance.

## Install

- `git clone`
- `npm install`
- `cp .env.dist .env`
- Fill in the necessary environnement variables
- copy a `zuliprc` file to the root of the repository
- `node index.js`

## Environnement Variables

- `SLACK_TOKEN` : Slack Bot User OAuth Access Token
- A `zuliprc` file should be placed at the root of the project

## Usage

- Create and install a new slack app on your workspace
- Invite the bot the channels you desire to bridge (`/invite @{bot_handle}`)
- The bot will then respond to the following commands

    - `zulip/link {zulipStream:zulipTopic}`
Will link the channel where this command has been sent to on slack to a Zulip Stream. You can also specify a topic by adding a colon (`:`) between the stream and the topic.
    - `zulip/unlink`
Removes all links of the channel where this command has been sent.