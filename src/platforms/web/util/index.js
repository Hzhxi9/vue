/* @flow */

import { warn } from "core/util/index";

export * from "./attrs";
export * from "./class";
export * from "./element";

/**
 * Query an element selector if it's not an element already.
 * 查询元素
 */
export function query(el: string | Element): Element {
  if (typeof el === "string") {
    /**如果是字符串 */
    /**获取元素 */
    const selected = document.querySelector(el);

    if (!selected) {
      process.env.NODE_ENV !== "production" &&
        warn("Cannot find element: " + el);
      /**不存在创建一个div */
      return document.createElement("div");
    }
    return selected;
  } else {
    /**如果是一个元素，就直接返回 */
    return el;
  }
}
