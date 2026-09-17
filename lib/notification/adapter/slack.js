/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import Slack from 'slack';
import { readAdapterReadme } from '../../services/markdown.js';
import { normalizeImageUrls } from '../../utils.js';
import { toPriceChangeListing, priceChangeTitle } from '../priceChangeMessage.js';

/**
 * Block Kit allows up to 50 blocks per message; the fixed blocks above use up to six of those, so
 * this leaves a wide margin without ever approaching the limit on a listing with a large gallery.
 * @type {number}
 */
const MAX_SLACK_IMAGES = 10;

const buildBlocks = (serviceName, jobKey, p, baseUrl) => {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `New Listing from ${serviceName} (${jobKey})`, emoji: false },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*<${p.link}|${p.title}>*` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Price*\n${p.price ?? 'n/a'}` },
        { type: 'mrkdwn', text: `*Size*\n${p.size ?? 'n/a'}` },
        { type: 'mrkdwn', text: `*Address*\n${p.address ?? 'n/a'}` },
      ],
    },
  ];

  // Its own section rather than a fourth field: the fields above are two per row, and a commute
  // line for several addresses is far too long for half a row.
  if (p.commute) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Commute*\n${p.commute}` },
    });
  }

  // Every image the listing has, not just the first - Slack fetches image blocks from the URL
  // itself, so a gallery costs no extra requests here the way it does for Telegram or MailJet.
  const images = normalizeImageUrls(p.images?.length > 0 ? p.images : [p.image]).slice(0, MAX_SLACK_IMAGES);
  for (const img of images) {
    blocks.push({
      type: 'image',
      image_url: img,
      alt_text: p.title || 'listing image',
    });
  }

  if (baseUrl && p.id) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `<${baseUrl}/#/listings/listing/${p.id}|Open in Fredy>` },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'Powered by Fredy' }],
  });

  return blocks;
};

export const send = ({ serviceName, newListings, notificationConfig, jobKey, baseUrl }) => {
  const { token, channel } = notificationConfig.find((a) => a.id === config.id).fields;

  return Promise.allSettled(
    newListings.map((p) =>
      Slack.chat.postMessage({
        token,
        channel,
        text: `${serviceName} ${jobKey}: ${p.title}`,
        blocks: buildBlocks(serviceName, jobKey, p, baseUrl),
        unfurl_links: false,
        unfurl_media: false,
      }),
    ),
  );
};

/**
 * @param {{serviceName: string, priceChanges: any[], notificationConfig: any[], jobKey: string, baseUrl: string}} params
 * @returns {Promise<any>}
 */
export const sendPriceChange = ({ serviceName, priceChanges, notificationConfig, jobKey, baseUrl }) => {
  const { token, channel } = notificationConfig.find((a) => a.id === config.id).fields;

  return Promise.allSettled(
    priceChanges.map((change) =>
      Slack.chat.postMessage({
        token,
        channel,
        text: `${serviceName} ${jobKey}: ${priceChangeTitle(change)}`,
        blocks: buildBlocks(serviceName, jobKey, toPriceChangeListing(change), baseUrl),
        unfurl_links: false,
        unfurl_media: false,
      }),
    ),
  );
};

export const config = {
  id: 'slack',
  name: 'Slack',
  readme: readAdapterReadme('slack.md'),
  description: 'Fredy will send new listings to the slack channel of your choice..',
  fields: {
    token: {
      type: 'text',
      label: 'Token',
      description: 'The token needed to send notifications to slack.',
      // Never leaves the server for anyone who may not edit this channel.
      secret: true,
    },
    channel: {
      type: 'channel',
      label: 'Channel',
      description: 'The channel where fredy should send notifications to.',
      // Shown as the channel's destination in the UI.
      target: true,
    },
  },
};
