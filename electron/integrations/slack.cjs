const { WebClient } = require('@slack/web-api');
const store = require('./store.cjs');

function getToken() {
  return store.get('slackToken');
}

function setToken(token) {
  store.set('slackToken', token, true);
}

function clearToken() {
  store.del('slackToken');
  store.del('slackTeam');
}

function client() {
  const token = getToken();
  if (!token) throw new Error('NO_SLACK_TOKEN');
  return new WebClient(token);
}

async function testAuth(rawToken) {
  const c = new WebClient(rawToken || getToken());
  const r = await c.auth.test();
  if (r.ok) {
    store.set('slackTeam', { team: r.team, teamId: r.team_id, user: r.user, userId: r.user_id, url: r.url });
  }
  return { ok: r.ok, team: r.team, user: r.user, url: r.url };
}

async function getStatus() {
  const token = getToken();
  const team = store.get('slackTeam');
  return { hasToken: !!token, team: team || null };
}

async function listChannels(types = 'public_channel,private_channel,im,mpim') {
  const c = client();
  // Paginate conversations (workspaces with many channels need >1 page)
  const all = [];
  let cursor;
  do {
    const r = await c.conversations.list({ types, limit: 1000, exclude_archived: true, cursor });
    all.push(...(r.channels || []));
    cursor = r.response_metadata?.next_cursor || undefined;
  } while (cursor && all.length < 5000);

  // Bulk-fetch all user info once (much faster than N users.info calls)
  const ims = all.filter((ch) => ch.is_im);
  const userMap = {};
  if (ims.length > 0) {
    try {
      let userCursor;
      do {
        const usersRes = await c.users.list({ limit: 1000, cursor: userCursor });
        (usersRes.members || []).forEach((u) => {
          userMap[u.id] = u.real_name || u.profile?.real_name_normalized || u.profile?.display_name || u.name || u.id;
        });
        userCursor = usersRes.response_metadata?.next_cursor || undefined;
      } while (userCursor);
    } catch (e) {
      // Fall back to per-user lookups for IMs we have no name for
      await Promise.all(
        ims.map(async (ch) => {
          if (userMap[ch.user]) return;
          try {
            const u = await c.users.info({ user: ch.user });
            userMap[ch.user] = u.user.real_name || u.user.name || ch.user;
          } catch {
            userMap[ch.user] = ch.user;
          }
        })
      );
    }
  }

  return all.map((ch) => ({
    id: ch.id,
    name: ch.is_im ? `DM · ${userMap[ch.user] || ch.user}` : ch.name,
    isPrivate: ch.is_private,
    isIM: !!ch.is_im,
    isMember: ch.is_member,
    topic: ch.topic?.value || '',
    user: ch.user,
  }));
}

async function findChannelByName(name) {
  const list = await listChannels('public_channel,private_channel');
  return list.find((c) => c.name === name || c.name === name.toLowerCase());
}

async function findDmByUserName(displayName) {
  const c = client();
  const ims = await listChannels('im');
  return ims.find((d) => d.name.includes(displayName));
}

async function readChannel(channelId, limit = 50) {
  const c = client();
  const r = await c.conversations.history({ channel: channelId, limit });
  return (r.messages || []).map((m) => ({
    ts: m.ts,
    user: m.user || m.bot_id || 'system',
    text: m.text || '',
    threadTs: m.thread_ts,
    replyCount: m.reply_count || 0,
  }));
}

async function searchMessages(query, count = 30) {
  const c = client();
  const r = await c.search.messages({ query, count, sort: 'timestamp', sort_dir: 'desc' });
  return (r.messages?.matches || []).map((m) => ({
    ts: m.ts,
    user: m.username || m.user,
    text: m.text || '',
    channel: m.channel?.name,
    permalink: m.permalink,
  }));
}

async function postMessage(channel, text) {
  const c = client();
  const r = await c.chat.postMessage({ channel, text });
  return { ok: r.ok, ts: r.ts, channel: r.channel };
}

async function readMultiple(channelIds, limitEach = 30) {
  const c = client();
  const results = await Promise.all(
    channelIds.map(async (id) => {
      try {
        const r = await c.conversations.history({ channel: id, limit: limitEach });
        return (r.messages || []).map((m) => ({
          channelId: id,
          ts: m.ts,
          user: m.user || m.bot_id || 'system',
          text: m.text || '',
          threadTs: m.thread_ts,
          replyCount: m.reply_count || 0,
        }));
      } catch (e) {
        return [];
      }
    })
  );
  // Flatten + resolve user names
  const flat = results.flat();
  const userIds = Array.from(new Set(flat.map((m) => m.user).filter((u) => u && /^U/.test(u))));
  const userInfo = {};
  await Promise.all(
    userIds.slice(0, 100).map(async (u) => {
      try {
        const r = await c.users.info({ user: u });
        userInfo[u] = r.user.real_name || r.user.name || u;
      } catch {
        userInfo[u] = u;
      }
    })
  );
  return flat
    .map((m) => ({ ...m, userName: userInfo[m.user] || m.user }))
    .sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));
}

module.exports = {
  setToken,
  testAuth,
  getStatus,
  clearToken,
  listChannels,
  readChannel,
  readMultiple,
  searchMessages,
  postMessage,
  findChannelByName,
  findDmByUserName,
};
