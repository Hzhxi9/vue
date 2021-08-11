/**
 * Not type-checking this file because it's mostly vendor code.
 */

/*!
 * HTML Parser By John Resig (ejohn.org)
 * Modified by Juriy "kangax" Zaytsev
 * Original code by Erik Arvidsson (MPL-1.1 OR Apache-2.0 OR GPL-2.0-or-later)
 * http://erik.eae.net/simplehtmlparser/simplehtmlparser.js
 */

import { makeMap, no } from "shared/util";
import { isNonPhrasingTag } from "web/compiler/util";
import { unicodeRegExp } from "core/util/lang";

// Regular Expressions for parsing tags and attributes
const attribute =
  /^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/;
const dynamicArgAttribute =
  /^\s*((?:v-[\w-]+:|@|:|#)\[[^=]+?\][^\s"'<>\/=]*)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/;
const ncname = `[a-zA-Z_][\\-\\.0-9_a-zA-Z${unicodeRegExp.source}]*`;
const qnameCapture = `((?:${ncname}\\:)?${ncname})`;
const startTagOpen = new RegExp(`^<${qnameCapture}`);
const startTagClose = /^\s*(\/?)>/;
const endTag = new RegExp(`^<\\/${qnameCapture}[^>]*>`);
const doctype = /^<!DOCTYPE [^>]+>/i;
// #7298: escape - to avoid being passed as HTML comment when inlined in page
const comment = /^<!\--/;
const conditionalComment = /^<!\[/;

// Special Elements (can contain anything)

export const isPlainTextElement = makeMap("script,style,textarea", true);
const reCache = {};

const decodingMap = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&amp;": "&",
  "&#10;": "\n",
  "&#9;": "\t",
  "&#39;": "'",
};
const encodedAttr = /&(?:lt|gt|quot|amp|#39);/g;
const encodedAttrWithNewLines = /&(?:lt|gt|quot|amp|#39|#10|#9);/g;

// #5992
const isIgnoreNewlineTag = makeMap("pre,textarea", true);
const shouldIgnoreFirstNewline = (tag, html) =>
  tag && isIgnoreNewlineTag(tag) && html[0] === "\n";

function decodeAttr(value, shouldDecodeNewlines) {
  const re = shouldDecodeNewlines ? encodedAttrWithNewLines : encodedAttr;
  return value.replace(re, (match) => decodingMap[match]);
}

/**
 * 通过循环遍历html模板字符串，依次处理其中的各个标签，以及标签上的属性
 * @param {*} html html模板
 * @param {*} options 配置项
 */
export function parseHTML(html, options) {
  const stack = [];
  const expectHTML = options.expectHTML;
  /**是否为自闭合标签 */
  const isUnaryTag = options.isUnaryTag || no;
  /**是否可以只有开始标签 */
  const canBeLeftOpenTag = options.canBeLeftOpenTag || no;
  /**记录当前在原始html字符串中的开始位置 */
  let index = 0;
  let last, lastTag;
  /**循环遍历html字符串 */
  while (html) {
    last = html;
    // Make sure we're not in a plaintext content element like script/style
    /**确保不是在 script、style、textarea 这样的纯文本元素中 */
    if (!lastTag || !isPlainTextElement(lastTag)) {
      /**找出第一个<字符 */
      let textEnd = html.indexOf("<");

      /**
       * textEnd === 0说明在开头找到
       * 分别处理可能找到的注释标签，条件注释标签，Doctype，开始标签，结束标签
       * 每处理完一种情况，就会截取（continue）循环，并且重置html字符串，将处理过的标签截取，下一次循环处理剩余的html字符串模板
       */
      if (textEnd === 0) {
        // Comment:
        /**
         * 处理注释标签
         * <!-- xx -->
         */
        if (comment.test(html)) {
          /**注释标签的结束索引 */
          const commentEnd = html.indexOf("-->");

          if (commentEnd >= 0) {
            /**是否应该保留注释 */
            if (options.shouldKeepComment) {
              /**得到：注释内容、注释的开始索引、结束索引 */
              options.comment(
                html.substring(4, commentEnd),
                index,
                index + commentEnd + 3
              );
            }
            /**
             * 剪切整个注释内容
             * 调整html和index变量
             **/
            advance(commentEnd + 3);
            continue;
          }
        }

        // http://en.wikipedia.org/wiki/Conditional_comment#Downlevel-revealed_conditional_comment
        /**处理条件注释 <!-- [if IE]>  */
        if (conditionalComment.test(html)) {
          /**找到结束索引 */
          const conditionalEnd = html.indexOf("]>");

          if (conditionalEnd >= 0) {
            /**调整html和index变量 */
            advance(conditionalEnd + 2);
            continue;
          }
        }

        // Doctype:
        /**处理Doctype： <!Doctype html> */
        const doctypeMatch = html.match(doctype);
        if (doctypeMatch) {
          advance(doctypeMatch[0].length);
          continue;
        }

        /**
         * 重点
         * 处理开始标签和结束标签是这整个函数中的核型部分，其它的不用管
         * 这两部分就是在构造 element ast
         **/

        // End tag:
        /**处理结束标签， 比如</div> */
        const endTagMatch = html.match(endTag);
        if (endTagMatch) {
          const curIndex = index;
          advance(endTagMatch[0].length);
          /**处理结束标签 */
          parseEndTag(endTagMatch[1], curIndex, index);
          continue;
        }

        // Start tag:
        /**
         * 处理开始标签  <div id="app">
         * startTagMatch = { tagName: 'div', attrs: [[xx], ...], start: index }
         **/
        const startTagMatch = parseStartTag();
        if (startTagMatch) {
          /**
           * 进一步处理上一步得到对象，并最后调用options.start方法
           * 真正解析工作都是在这个start方法中做的
           */
          handleStartTag(startTagMatch);
          if (shouldIgnoreFirstNewline(startTagMatch.tagName, html)) {
            advance(1);
          }
          continue;
        }
      }

      let text, rest, next;
      if (textEnd >= 0) {
        /**
         * 能走到这里，说明虽然在html匹配到到了<xx, 但是这不属于上述几种情况
         * 他就只是一个普通的一段文本：<我是文本
         * 于是从html中找到下一个<, 直到<xx是上述几种情况的标签，则结束
         * 在这整个过程一直在调整textEnd的值，作为html中下一个有效标签的开始位置
         */

        /**截取html字符串中textEnd之后的内容， rest = <xx */
        rest = html.slice(textEnd);

        /**
         * 这个while循环就是处理<xx 之后的纯文本的情况
         * 截取文本内容，并找到有效标签的开始位置(textEnd)
         */
        while (
          !endTag.test(rest) &&
          !startTagOpen.test(rest) &&
          !comment.test(rest) &&
          !conditionalComment.test(rest)
        ) {
          // < in plain text, be forgiving and treat it as text
          /**认为< 后面的内容为纯文本，然后在这些纯文本中再找到< */
          next = rest.indexOf("<", 1);
          /**如果没有找到<， 则直接结束循环 */
          if (next < 0) break;
          /**走到这儿说明在后续的字符串中找到了 <，索引位置为 textEnd */
          textEnd += next;
          /**截取 html 字符串模版 textEnd 之后的内容赋值给 rest，继续判断之后的字符串是否存在标签 */
          rest = html.slice(textEnd);
        }
        /**走到这里，说明遍历结束，有两种情况，一种是 < 之后就是一段纯文本，要不就是在后面找到了有效标签，截取文本 */
        text = html.substring(0, textEnd);
      }

      if (textEnd < 0) {
        text = html;
      }

      if (text) {
        advance(text.length);
      }

      if (options.chars && text) {
        options.chars(text, index - text.length, index);
      }
    } else {
      let endTagLength = 0;
      const stackedTag = lastTag.toLowerCase();
      const reStackedTag =
        reCache[stackedTag] ||
        (reCache[stackedTag] = new RegExp(
          "([\\s\\S]*?)(</" + stackedTag + "[^>]*>)",
          "i"
        ));
      const rest = html.replace(reStackedTag, function (all, text, endTag) {
        endTagLength = endTag.length;
        if (!isPlainTextElement(stackedTag) && stackedTag !== "noscript") {
          text = text
            .replace(/<!\--([\s\S]*?)-->/g, "$1") // #7298
            .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1");
        }
        if (shouldIgnoreFirstNewline(stackedTag, text)) {
          text = text.slice(1);
        }
        if (options.chars) {
          options.chars(text);
        }
        return "";
      });
      index += html.length - rest.length;
      html = rest;
      parseEndTag(stackedTag, index - endTagLength, index);
    }

    if (html === last) {
      options.chars && options.chars(html);
      if (
        process.env.NODE_ENV !== "production" &&
        !stack.length &&
        options.warn
      ) {
        options.warn(`Mal-formatted tag at end of template: "${html}"`, {
          start: index + html.length,
        });
      }
      break;
    }
  }

  // Clean up any remaining tags
  parseEndTag();

  /**
   * 重置html， html = 从索引位置开始的向后的所有字符串
   * index为html在原始的模板字符串中的开始索引，也是下一次该处理的字符的开始位置
   * @param {*} n 索引
   */
  function advance(n) {
    index += n;
    html = html.substring(n);
  }

  /**
   * 解析开始标签，<div id="app">
   * @returns {tagName: 'div', attr:[[xx],...], start: index}
   */
  function parseStartTag() {
    /**<start></start> */
    const start = html.match(startTagOpen);
    if (start) {
      /**处理结果 */
      const match = {
        /**标签名 */
        tagName: start[1],
        /**属性数组 */
        attrs: [],
        /**标签开始的位置 */
        start: index,
      };
      /**
       * 裁剪整个开始标签
       * 调整html和index
       * 比如:
       * html = " id='app'>"
       * index = 此时的索引
       * start = '<div'
       **/
      advance(start[0].length);
      let end, attr;
      /**
       * 处理开始标签内的各个属性，并将这些属性放到match.attrs数组中
       */
      while (
        !(end = html.match(startTagClose)) &&
        (attr = html.match(dynamicArgAttribute) || html.match(attribute))
      ) {
        attr.start = index;
        advance(attr[0].length);
        attr.end = index;
        match.attrs.push(attr);
      }
      /**开始标签的结束，end=">"或者end=' />' */
      if (end) {
        match.unarySlash = end[1];
        advance(end[0].length);
        match.end = index;
        return match;
      }
    }
  }

  /**
   * 进一步处理开始标签的解析结果 -- match对象
   *   处理属性match.attrs，如果不是自闭合标签，则将标签信息放到stack数组，
   *   待将来处理到它的闭合标签时再将其弹出stack，表示该标签处理完毕，这是标签的所有信息都在element ast对象上了
   *   接下来调用options.start方法处理标签，并根据标签信息生成element ast
   *   以及处理开始标签上的属性和指令，最后将element ast放入stack数组
   *
   * @param {*} match {tagName: 'div', attr:[[xx],...], start: index}
   */
  function handleStartTag(match) {
    /**标签名字 */
    const tagName = match.tagName;
    /**可能是一个自闭合标签 /> */
    const unarySlash = match.unarySlash;

    /**处理p标签 */
    if (expectHTML) {
      if (lastTag === "p" && isNonPhrasingTag(tagName)) {
        parseEndTag(lastTag);
      }
      if (canBeLeftOpenTag(tagName) && lastTag === tagName) {
        parseEndTag(tagName);
      }
    }

    /**判断是否为自闭合标签 <hr /> */
    const unary = isUnaryTag(tagName) || !!unarySlash;

    /**
     * 处理attrs 得到 attrs = [{ name: attrName, value: attrVal, start: xx, end: xx }, ...]
     * 得到[{name: attrName, value: attrValue, start, end}, ...]
     **/
    const l = match.attrs.length;
    const attrs = new Array(l);
    for (let i = 0; i < l; i++) {
      const args = match.attrs[i];
      // 比如：args[3] => 'id'，args[4] => '='，args[5] => 'app'
      const value = args[3] || args[4] || args[5] || "";
      const shouldDecodeNewlines =
        tagName === "a" && args[1] === "href"
          ? options.shouldDecodeNewlinesForHref
          : options.shouldDecodeNewlines;
      /** attrs[i] = { id: 'app' } */
      attrs[i] = {
        name: args[1],
        value: decodeAttr(value, shouldDecodeNewlines),
      };
      /**非生产环境，记录属性的开始和结束索引 */
      if (process.env.NODE_ENV !== "production" && options.outputSourceRange) {
        attrs[i].start = args.start + args[0].match(/^\s*/).length;
        attrs[i].end = args.end;
      }
    }

    /**
     *  如果不是自闭合标签，则将标签信息放到 stack 数组中，待将来处理到它的闭合标签时再将其弹出 stack
     *  如果是自闭合标签，则标签信息就没必要进入 stack 了，直接处理众多属性，将他们都设置到 element ast 对象上，就没有处理 结束标签的那一步了，这一步在处理开始标签的过程中就进行了
     **/
    if (!unary) {
      /**
       * 非自闭合标签
       * 将标签信息放到 stack 数组中，{ tag, lowerCasedTag, attrs, start, end }
       **/
      stack.push({
        tag: tagName,
        lowerCasedTag: tagName.toLowerCase(),
        attrs: attrs,
        start: match.start,
        end: match.end,
      });
      /**标识当前标签的结束标签为 tagName */
      lastTag = tagName;
    }

    /**
     * 调用 start 方法，主要做了以下 6 件事情:
     *  1、创建 AST 对象
     *  2、处理存在 v-model 指令的 input 标签，分别处理 input 为 checkbox、radio、其它的情况
     *  3、处理标签上的众多指令，比如 v-pre、v-for、v-if、v-once
     *  4、如果根节点 root 不存在则设置当前元素为根节点
     *  5、如果当前元素为非自闭合标签则将自己 push 到 stack 数组，并记录 currentParent，在接下来处理子元素时用来告诉子元素自己的父节点是谁
     *  6、如果当前元素为自闭合标签，则表示该标签要处理结束了，让自己和父元素产生关系，以及设置自己的子元素
     */
    if (options.start) {
      options.start(tagName, attrs, unary, match.start, match.end);
    }
  }

  /**
   * 解析结束标签，比如：</div>
   *   最主要的事就是：
   *   1、处理 stack 数组，从 stack 数组中找到当前结束标签对应的开始标签，然后调用 options.end 方法
   *   2、处理完结束标签之后调整 stack 数组，保证在正常情况下 stack 数组中的最后一个元素就是下一个结束标签对应的开始标签
   *   3、处理一些异常情况，比如 stack 数组最后一个元素不是当前结束标签对应的开始标签，还有就是br 和 p 标签单独处理
   * @param {*} tagName 标签名， 比如div
   * @param {*} start 结束标签的开始索引位置
   * @param {*} end 结束标签的结束索引位置
   */
  function parseEndTag(tagName, start, end) {
    let pos, lowerCasedTagName;
    if (start == null) start = index;
    if (end == null) end = index;

    /**
     * 倒序遍历 stack 数组，找到第一个和当前结束标签相同的标签，该标签就是结束标签对应的开始标签的描述对象
     * 理论上，不出异常，stack 数组中的最后一个元素就是当前结束标签的开始标签的描述对象
     * Find the closest opened tag of the same type
     */
    if (tagName) {
      lowerCasedTagName = tagName.toLowerCase();
      for (pos = stack.length - 1; pos >= 0; pos--) {
        if (stack[pos].lowerCasedTag === lowerCasedTagName) {
          break;
        }
      }
    } else {
      // If no tag name is provided, clean shop
      pos = 0;
    }

    /**如果在 stack 中一直没有找到相同的标签名，则 pos 就会 < 0，进行后面的 else 分支 */
    if (pos >= 0) {
      /**
       * 这个 for 循环负责关闭 stack 数组中索引 >= pos 的所有标签
       * 为什么要用一个循环，上面说到正常情况下 stack 数组的最后一个元素就是我们要找的开始标签，
       * 但是有些异常情况，就是有些元素没有给提供结束标签，比如：
       * stack = ['span', 'div', 'span', 'h1']，当前处理的结束标签 tagName = div
       * 匹配到 div，pos = 1，那索引为 2 和 3 的两个标签（span、h1）说明就没提供结束标签
       * 这个 for 循环就负责关闭 div、span 和 h1 这三个标签，
       * 并在开发环境为 span 和 h1 这两个标签给出 ”未匹配到结束标签的提示”
       *
       * Close all the open elements, up the stack
       */
      for (let i = stack.length - 1; i >= pos; i--) {
        if (
          process.env.NODE_ENV !== "production" &&
          (i > pos || !tagName) &&
          options.warn
        ) {
          options.warn(`tag <${stack[i].tag}> has no matching end tag.`, {
            start: stack[i].start,
            end: stack[i].end,
          });
        }
        /**走到这里，说明上面的异常情况都处理完了，调用 options.end 处理正常的结束标签 */
        if (options.end) {
          options.end(stack[i].tag, start, end);
        }
      }

      // Remove the open elements from the stack
      /**将刚才处理的那些标签从数组中移除，保证数组的最后一个元素就是下一个结束标签对应的开始标签 */
      stack.length = pos;

      /**astTag 记录 stack 数组中未处理的最后一个开始标签 */
      lastTag = pos && stack[pos - 1].tag;
    } else if (lowerCasedTagName === "br") {
      /**当前处理的标签为 <br /> 标签 */
      if (options.start) {
        options.start(tagName, [], true, start, end);
      }
    } else if (lowerCasedTagName === "p") {
      /**当前处理的标签为 <p> 标签 */
      if (options.start) {
        options.start(tagName, [], false, start, end);
      }
      /**当前处理的标签为 </p> 标签  */
      if (options.end) {
        options.end(tagName, start, end);
      }
    }
  }
}
