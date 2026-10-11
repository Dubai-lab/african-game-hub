-- Quick messages in the chat between the players of a match.
--
-- Beside free text and reactions, a player can now send a ready-made message with one touch
-- ("Good luck", "Nice shot"). What is stored is the message's name, not its words, so each
-- player reads it in their own language. Only the names listed here are accepted.
--
-- The set of reactions also grows. Nothing already stored changes, and an app that has not
-- been updated yet goes on working: it simply does not offer the new messages.

alter table public.match_messages drop constraint match_messages_kind_check;
alter table public.match_messages add constraint match_messages_kind_check check (kind in ('text', 'emoji', 'quick'));

create or replace function public.send_match_message(p_match_id uuid, p_kind text, p_body text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_body text := trim(coalesce(p_body, ''));
  v_status jsonb;
  v_id bigint;
  -- The reactions on offer. Anything else sent as an "emoji" is refused.
  -- (Must match EMOJI in src/core/social/quickMessages.ts.)
  v_emoji constant text[] := array[
    '👍','👎','👏','🙌','🤝','🙏','💪','🔥',
    '🙂','😀','😂','😉','😎','🤔','😮','😱',
    '😅','😬','😴','😢','😭','😡','🤯','🥳',
    '❤️','💔','⭐','🏆','🎯','🎲','⏳','👀'];
  -- The ready-made messages, by name. Every game shares the first row; the rest belong to one
  -- game or another, and the app offers each game its own.
  -- (Must match QUICK_MESSAGES in src/core/social/quickMessages.ts.)
  v_quick constant text[] := array[
    'hello','good_luck','good_game','well_played','thanks','sorry','oops','gotta_go','rematch',
    'good_move','close_game','nice_capture','nice_roll','lucky','so_close','nice_shot','great_break','unlucky'];
begin
  if v_me is null or not private.is_match_player(p_match_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_PLAYER');
  end if;
  -- During the game, and for ten minutes afterwards (time to say "good game").
  if not exists (
    select 1 from public.matches m
     where m.id = p_match_id
       and (m.status = 'active' or (m.status in ('finished', 'aborted') and m.finished_at > now() - interval '10 minutes'))) then
    return jsonb_build_object('ok', false, 'code', 'CHAT_CLOSED');
  end if;

  v_status := public.match_chat_status(p_match_id);
  if not (v_status ->> 'mine')::boolean then
    return jsonb_build_object('ok', false, 'code', 'CHAT_OFF_YOU');
  end if;
  if not (v_status ->> 'others')::boolean then
    return jsonb_build_object('ok', false, 'code', 'CHAT_OFF_OPPONENT');
  end if;

  if p_kind = 'emoji' then
    if not (v_body = any (v_emoji)) then
      return jsonb_build_object('ok', false, 'code', 'BAD_MESSAGE');
    end if;
  elsif p_kind = 'quick' then
    if not (v_body = any (v_quick)) then
      return jsonb_build_object('ok', false, 'code', 'BAD_MESSAGE');
    end if;
  elsif p_kind = 'text' then
    if char_length(v_body) < 1 or char_length(v_body) > 200 then
      return jsonb_build_object('ok', false, 'code', 'BAD_MESSAGE');
    end if;
  else
    return jsonb_build_object('ok', false, 'code', 'BAD_MESSAGE');
  end if;

  -- No flooding an opponent who is trying to think.
  if (select count(*) from public.match_messages mm
       where mm.match_id = p_match_id and mm.sender_id = v_me and mm.created_at > now() - interval '10 seconds') >= 5 then
    return jsonb_build_object('ok', false, 'code', 'SLOW_DOWN');
  end if;

  insert into public.match_messages (match_id, sender_id, kind, body) values (p_match_id, v_me, p_kind, v_body) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
