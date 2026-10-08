import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useAuth } from '@/core/auth/AuthContext'
import i18n from '@/core/i18n'
import { refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { toast } from '@/core/ui/toast'

// Friends and private messages. The app only reads these tables; every change goes through a
// database function that acts as the signed-in player and enforces the privacy rules (most
// importantly: no accepted friendship, no private message).

export type Relation = 'friend' | 'incoming' | 'outgoing'
export type Contact = {
  userId: string
  username: string
  name: string
  countryCode: string | null
  relation: Relation
  /** Private messages from this player that have not been opened yet. */
  unread: number
}

type Reply = { ok: boolean; code?: string; status?: string }

const contactsKey = (userId: string | undefined) => ['friends', userId]
export const conversationKey = (userId: string | undefined, otherId: string | undefined) => ['dm', userId, otherId]

/** Everyone the player is friends with, has asked, or has been asked by. */
export function useContacts() {
  const { user } = useAuth()
  const me = user?.id
  return useQuery({
    queryKey: contactsKey(me),
    enabled: Boolean(me),
    staleTime: 15_000,
    meta: { errorKey: 'friends.loadFailed' },
    queryFn: async (): Promise<Contact[]> => {
      const [links, unread] = await Promise.all([
        supabase
          .from('friendships')
          .select(
            `status, requester_id, addressee_id,
             requester:profiles!friendships_requester_id_fkey (username, display_name, country_code),
             addressee:profiles!friendships_addressee_id_fkey (username, display_name, country_code)`,
          )
          .order('created_at', { ascending: false }),
        supabase.from('direct_messages').select('sender_id').eq('recipient_id', me!).is('read_at', null).limit(500),
      ])
      if (links.error) throw links.error
      if (unread.error) throw unread.error

      const waiting = new Map<string, number>()
      for (const row of unread.data) waiting.set(row.sender_id, (waiting.get(row.sender_id) ?? 0) + 1)

      return links.data.map((link) => {
        const iAsked = link.requester_id === me
        const other = iAsked ? link.addressee : link.requester
        const userId = iAsked ? link.addressee_id : link.requester_id
        return {
          userId,
          username: other.username,
          name: other.display_name ?? other.username,
          countryCode: other.country_code,
          relation: link.status === 'accepted' ? 'friend' : iAsked ? 'outgoing' : 'incoming',
          unread: waiting.get(userId) ?? 0,
        }
      })
    },
  })
}

/** How many things on the Friends tab are waiting for the player. */
export function useSocialBadge(): number {
  const contacts = useContacts().data ?? []
  return contacts.reduce((sum, c) => sum + c.unread + (c.relation === 'incoming' ? 1 : 0), 0)
}

type SocialFunction =
  | 'send_friend_request'
  | 'respond_friend_request'
  | 'remove_friend'
  | 'send_direct_message'
  | 'block_player'
  | 'unblock_player'
  | 'report_player'

async function call(fn: SocialFunction, args: Record<string, unknown>) {
  try {
    const { data, error } = await supabase.rpc(fn, args as never)
    if (error) {
      toast.error(i18n.t('errors.generic'))
      return null
    }
    const reply = data as Reply
    if (!reply.ok) {
      toast.error(refusalMessage(reply.code ?? 'SERVER_ERROR'))
      return null
    }
    return reply
  } catch {
    toast.error(i18n.t('errors.network'))
    return null
  }
}

export function useFriendActions() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: contactsKey(user?.id) })

  return {
    request: async (username: string) => {
      const reply = await call('send_friend_request', { p_username: username })
      if (reply) {
        toast.success(i18n.t(reply.status === 'accepted' ? 'friends.nowFriends' : 'friends.requestSent'))
        await refresh()
      }
      return reply !== null
    },
    respond: async (requesterId: string, accept: boolean) => {
      const reply = await call('respond_friend_request', { p_requester_id: requesterId, p_accept: accept })
      await refresh()
      return reply !== null
    },
    remove: async (otherId: string) => {
      await call('remove_friend', { p_other_id: otherId })
      await refresh()
    },
  }
}

export type Message = { id: number; mine: boolean; body: string; createdAt: string }

/** The most recent messages between the player and one friend, oldest first. */
export function useConversation(otherId: string | undefined) {
  const { user } = useAuth()
  const me = user?.id
  return useQuery({
    queryKey: conversationKey(me, otherId),
    enabled: Boolean(me && otherId),
    staleTime: 0,
    meta: { errorKey: 'chat.loadFailed' },
    queryFn: async (): Promise<Message[]> => {
      const { data, error } = await supabase
        .from('direct_messages')
        .select('id, sender_id, body, created_at')
        .or(`and(sender_id.eq.${me},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${me})`)
        .order('id', { ascending: false })
        .limit(80)
      if (error) throw error
      return data.reverse().map((m) => ({ id: m.id, mine: m.sender_id === me, body: m.body, createdAt: m.created_at }))
    },
  })
}

export async function sendDirectMessage(to: string, body: string): Promise<boolean> {
  return (await call('send_direct_message', { p_to: to, p_body: body })) !== null
}

export async function markRead(from: string) {
  try {
    await supabase.rpc('mark_messages_read', { p_from: from })
  } catch {
    // A read receipt that fails is retried the next time the conversation is opened.
  }
}

let channelSeq = 0

/**
 * Mounted once for a signed-in player: new messages and friend requests arrive live, on any
 * page. Realtime only ever delivers rows the player is allowed to read.
 */
export function useSocialLiveUpdates() {
  const { user } = useAuth()
  const me = user?.id
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!me) return
    const refreshContacts = () => void queryClient.invalidateQueries({ queryKey: contactsKey(me) })
    const channel = supabase
      .channel(`social:${me}:${++channelSeq}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${me}` }, (payload) => {
        const sender = (payload.new as { sender_id?: string }).sender_id
        void queryClient.invalidateQueries({ queryKey: conversationKey(me, sender) })
        refreshContacts()
        // Tell the player, unless they are already looking at that conversation.
        const contacts = queryClient.getQueryData<Contact[]>(contactsKey(me))
        const from = contacts?.find((c) => c.userId === sender)
        if (from && !window.location.pathname.endsWith(`/friends/${from.username}`)) {
          toast.info(i18n.t('chat.newMessage', { name: from.name }))
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `addressee_id=eq.${me}` }, refreshContacts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `requester_id=eq.${me}` }, refreshContacts)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refreshContacts()
      })
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [me, queryClient])
}

/** The player's own "live chat during games" switch. Stored on the account and enforced by the server. */
export function useMatchChatSetting() {
  const { user } = useAuth()
  const me = user?.id
  const queryClient = useQueryClient()
  const key = ['match-chat-setting', me]
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(me),
    staleTime: 60_000,
    meta: { silent: true },
    queryFn: async () => {
      const { data, error } = await supabase.from('profile_private').select('match_chat_enabled').eq('user_id', me!).single()
      if (error) throw error
      return data.match_chat_enabled
    },
  })

  // The switch answers the tap at once; the account catches up a moment later.
  const [choice, setChoice] = useState<boolean | null>(null)

  async function set(enabled: boolean) {
    const previous = queryClient.getQueryData<boolean>(key)
    setChoice(enabled)
    queryClient.setQueryData(key, enabled)
    try {
      const { error } = await supabase.from('profile_private').update({ match_chat_enabled: enabled }).eq('user_id', me!)
      if (error) throw error
      void queryClient.invalidateQueries({ queryKey: ['match-chat-status'] })
    } catch {
      queryClient.setQueryData(key, previous)
      toast.error(i18n.t('errors.network'))
    } finally {
      setChoice(null)
    }
  }

  return { enabled: choice ?? query.data ?? true, loaded: choice !== null || query.data !== undefined, set }
}

export const REPORT_REASONS = ['abuse', 'cheating', 'multiple_accounts', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

/**
 * Sends a report to the admin team. When a match is named, the report carries what was said in
 * that match; otherwise it carries the private conversation between the two players.
 */
export async function reportPlayer(userId: string, reason: ReportReason, note: string, matchId?: string): Promise<boolean> {
  const reply = await call('report_player', { p_user_id: userId, p_reason: reason, p_note: note.trim() || null, p_match_id: matchId ?? null })
  return reply !== null
}

const blocksKey = (userId: string | undefined) => ['blocks', userId]

/** The players this player has blocked, and the two actions. A player never learns who blocked them. */
export function useBlocking() {
  const { user } = useAuth()
  const me = user?.id
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: blocksKey(me),
    enabled: Boolean(me),
    staleTime: 60_000,
    meta: { silent: true },
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.from('blocks').select('blocked_id')
      if (error) throw error
      return data.map((row) => row.blocked_id)
    },
  })

  async function change(fn: 'block_player' | 'unblock_player', userId: string, name: string) {
    const reply = await call(fn, { p_user_id: userId })
    if (reply) toast.success(i18n.t(fn === 'block_player' ? 'safety.blocked' : 'safety.unblocked', { name }))
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: blocksKey(me) }),
      queryClient.invalidateQueries({ queryKey: contactsKey(me) }),
      queryClient.invalidateQueries({ queryKey: ['match-chat-status'] }),
    ])
  }

  return {
    loaded: query.data !== undefined,
    isBlocked: (userId: string) => query.data?.includes(userId) ?? false,
    block: (userId: string, name: string) => change('block_player', userId, name),
    unblock: (userId: string, name: string) => change('unblock_player', userId, name),
  }
}
