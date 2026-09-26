/*
 * Blog author registry.
 *
 * Authors are Hi Design *team personas* — recurring bylines attributed to the
 * team, NOT impersonations of independent outside experts. A post opts in via
 * the optional `author: <id>` frontmatter field; posts without it render no
 * byline (unchanged behaviour). Avatars are warm editorial portrait
 * illustrations under `/public/blog/authors/<id>.png`.
 */
export interface BlogAuthor {
  id: string;
  name: string;
  role: string;
  bio: string;
  avatar: string;
}

export const BLOG_AUTHORS: Record<string, BlogAuthor> = {
  'mira-zhao': {
    id: 'mira-zhao',
    name: 'Mira Zhao',
    role: 'Design Engineer, Hi Design',
    bio: 'Works on the design-to-code pipeline at Hi Design and writes about agentic design workflows.',
    avatar: '/blog/authors/mira-zhao.webp',
  },
  'theo-lindqvist': {
    id: 'theo-lindqvist',
    name: 'Theo Lindqvist',
    role: 'Product, Hi Design',
    bio: 'Product at Hi Design, focused on BYOK and the open plugin ecosystem.',
    avatar: '/blog/authors/theo-lindqvist.webp',
  },
  'nadia-haddad': {
    id: 'nadia-haddad',
    name: 'Nadia Haddad',
    role: 'Design Systems, Hi Design',
    bio: 'Works on design systems and developer experience at Hi Design.',
    avatar: '/blog/authors/nadia-haddad.webp',
  },
};

export function getBlogAuthor(id: string | undefined): BlogAuthor | undefined {
  return id ? BLOG_AUTHORS[id] : undefined;
}
