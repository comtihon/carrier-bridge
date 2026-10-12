import { clsx } from "clsx";

/** Field chrome shared by the full-size modals (datasources, agents, events). */
export const dsFieldCls =
  "w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500";
export const dsFieldMonoCls = clsx(dsFieldCls, "font-mono text-xs");
