// Where the hub can be followed. One line per page: the footer of the landing page and the
// "Follow us" panel in Settings both show whatever is listed here, in this order, so a new
// page is added in this one place (with a sign for it in src/core/ui/SocialLinks.tsx).
export type SocialPage = { id: 'tiktok' | 'x'; name: string; url: string }

export const SOCIAL_LINKS: SocialPage[] = [
  { id: 'tiktok', name: 'TikTok', url: 'https://www.tiktok.com/@africangamehub.com' },
  { id: 'x', name: 'X', url: 'https://x.com/eg8217178' },
]
