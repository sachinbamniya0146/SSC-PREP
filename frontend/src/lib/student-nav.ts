/**
 * Student menu: ONE list of items and ONE list of routes, shared by the sidebar component and by the tiny script in
 * <head> that decides, before the first paint, whether the page gets a left menu (so the content never jumps).
 *
 * No "use client", no hooks: this file is also imported by the server layout.
 */

/** Browsing screens that get the left menu (tablet / desktop) or the bottom bar (phones). Never test / quiz screens. */
export const SIDEBAR_ROUTES = [
  "/dashboard",
  "/mocks",
  "/sectional",
  "/year-wise",
  "/build-test",
  "/question-bank",
  "/question-bank-practice",
  "/vocabulary",
  "/review",
  "/weak-topics",
  "/study-plan",
  "/bookmarks",
  "/leaderboard",
  "/referral",
  "/notifications",
  "/help",
  "/profile",
  "/premium",
  "/settings",
] as const;

export function isSidebarRoute(path: string): boolean {
  return SIDEBAR_ROUTES.some((p) => path === p || path.startsWith(p + "/"));
}

export type NavIconName =
  | "home" | "mock" | "book" | "pencil" | "abc" | "repeat" | "target" | "plan" | "star" | "rank" | "gift" | "help" | "user" | "bell";

export const NAV_ICONS: Record<NavIconName, string> = {
  home: "M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z",
  mock: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
  pencil: "M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z",
  abc: "M4 7V4h16v3M9 20h6M12 4v16",
  repeat: "M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3",
  target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  plan: "M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z",
  rank: "M18 20V10M12 20V4M6 20v-6",
  gift: "M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
  bell: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
};

export interface StudentNavItem {
  href: string;
  en: string;
  hi: string;
  icon: NavIconName;
  /** Extra path prefixes that keep this item highlighted (e.g. Tests stays active on /sectional). */
  also?: string[];
  /** Feature-controller flag; the item is hidden when the admin switched that feature off. */
  flag?: string;
}
export interface StudentNavGroup {
  id: string;
  en: string;
  hi: string;
  items: StudentNavItem[];
}

export const STUDENT_NAV: StudentNavGroup[] = [
  {
    id: "learn",
    en: "Learn",
    hi: "Padhai",
    items: [
      { href: "/dashboard", en: "Dashboard", hi: "Dashboard", icon: "home" },
      { href: "/mocks", en: "Mock tests", hi: "Mock test", icon: "mock", also: ["/sectional", "/year-wise"] },
      { href: "/build-test", en: "Build a test", hi: "Test banao", icon: "target" },
      { href: "/question-bank", en: "PYQ bank", hi: "PYQ bank", icon: "book" },
      { href: "/question-bank-practice", en: "Practice", hi: "Practice", icon: "pencil" },
      { href: "/vocabulary", en: "Vocabulary", hi: "Vocabulary", icon: "abc", flag: "vocabulary" },
    ],
  },
  {
    id: "improve",
    en: "Improve",
    hi: "Sudhar",
    items: [
      { href: "/review", en: "Revision", hi: "Revision", icon: "repeat" },
      { href: "/weak-topics", en: "Weak topics", hi: "Kamzor topics", icon: "target" },
      { href: "/study-plan", en: "Study plan", hi: "Study plan", icon: "plan" },
      { href: "/bookmarks", en: "Bookmarks", hi: "Bookmarks", icon: "star" },
      { href: "/leaderboard", en: "Rank", hi: "Rank", icon: "rank", flag: "leaderboard" },
    ],
  },
  {
    id: "account",
    en: "Account",
    hi: "Account",
    items: [
      { href: "/referral", en: "Refer & earn", hi: "Refer & earn", icon: "gift", flag: "referral" },
      { href: "/notifications", en: "Notifications", hi: "Notifications", icon: "bell" },
      { href: "/help", en: "Help", hi: "Madad", icon: "help" },
      { href: "/profile", en: "Profile", hi: "Profile", icon: "user" },
    ],
  },
];

export function isNavItemActive(item: StudentNavItem, path: string): boolean {
  return [item.href, ...(item.also ?? [])].some((p) => path === p || path.startsWith(p + "/"));
}

export const SIDEBAR_PREF_KEY = "ssc_sidebar"; // "rail" | "full"
export const RAIL_BELOW_PX = 1024; // no saved choice: icon rail on tablets, full menu on desktop

/**
 * Runs in <head> before the first paint: puts `has-sidebar` (and `sidebar-rail`) on <html> so the CSS can reserve the
 * space for the menu at once. The sidebar component repeats the same decision after hydration (route changes done by
 * the router rather than by a normal link).
 */
export const SIDEBAR_BOOT_SCRIPT =
  "(function(){try{var R=" +
  JSON.stringify(SIDEBAR_ROUTES) +
  ",p=location.pathname,ok=false,i;for(i=0;i<R.length;i++){if(p===R[i]||p.indexOf(R[i]+'/')===0){ok=true;break}}" +
  "if(ok&&localStorage.getItem('ssc_access_token')){var d=document.documentElement,s=localStorage.getItem('" +
  SIDEBAR_PREF_KEY +
  "');d.classList.add('has-sidebar');if(s?s==='rail':window.innerWidth<" +
  RAIL_BELOW_PX +
  ")d.classList.add('sidebar-rail')}}catch(e){}})();";
