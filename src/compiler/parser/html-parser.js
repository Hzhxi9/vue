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
/**
 * 解析标记和属性的正则表达式
 */
const attribute =
  /^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/;

/**匹配动态属性 */
const dynamicArgAttribute =
  /^\s*((?:v-[\w-]+:|@|:|#)\[[^=]+?\][^\s"'<>\/=]*)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/;

const ncname = `[a-zA-Z_][\\-\\.0-9_a-zA-Z${unicodeRegExp.source}]*`;

/**((?:[a-zA-Z_][\\w\\-\\.]*\\:)?[a-zA-Z_][\\w\\-\\.]*) */
const qnameCapture = `((?:${ncname}\\:)?${ncname})`;

/**匹配开头必需是< 后面可以忽略是任何字符串  ^<((?:[a-zA-Z_][\\w\\-\\.]*\\:)?[a-zA-Z_][\\w\\-\\.]*) */
const startTagOpen = new RegExp(`^<${qnameCapture}`);

/**匹配 > 标签 或者/> 闭合标签 */
const startTagClose = /^\s*(\/?)>/;

/**匹配开头必需是</ 后面可以忽略是任何字符串  ^<\\/((?:[a-zA-Z_][\\w\\-\\.]*\\:)?[a-zA-Z_][\\w\\-\\.]*)[^>]*> */
const endTag = new RegExp(`^<\\/${qnameCapture}[^>]*>`);

/**匹配html的头文件 <!DOCTYPE html> */
const doctype = /^<!DOCTYPE [^>]+>/i;

// #7298: escape - to avoid being passed as HTML comment when inlined in page
/**匹配 开始字符串为<!--任何字符串 */
const comment = /^<!\--/;

/**匹配开始为 <![ 字符串    匹配这样动态加ie浏览器的 字符串  <!--[if IE 8]><link href="ie8only.css" rel="stylesheet"><![endif]--> */
const conditionalComment = /^<!\[/;

// Special Elements (can contain anything)
/**判断标签是是否是script,style,textarea */
export const isPlainTextElement = makeMap("script,style,textarea", true);

const reCache = {};

/**替换 把   &lt;替换 <  ， &gt; 替换 > ， &quot;替换  "， &amp;替换 & ， &#10;替换\n  ，&#9;替换\t */
const decodingMap = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&amp;": "&",
  "&#10;": "\n",
  "&#9;": "\t",
  "&#39;": "'",
};

/**匹配 &lt或&gt或&quot或&amp */
const encodedAttr = /&(?:lt|gt|quot|amp|#39);/g;

/**匹配 &lt或&gt或&quot或&amp或&#10或&#9 */
const encodedAttrWithNewLines = /&(?:lt|gt|quot|amp|#39|#10|#9);/g;

// #5992 判断标签是否pre,textarea
const isIgnoreNewlineTag = makeMap("pre,textarea", true);

/**匹配tag标签是pre,textarea，并且第二个参数的第一个字符是回车键 */
const shouldIgnoreFirstNewline = (tag, html) =>
  tag && isIgnoreNewlineTag(tag) && html[0] === "\n";

/**
 * 替换html 中的特殊符号，转义成js解析的字符串,替换 把   &lt;替换 <  ， &gt; 替换 > ， &quot;替换  "， &amp;替换 & ， &#10;替换\n  ，&#9;替换\t
 * @param {*} value 标签中属性的值
 * @param {*} shouldDecodeNewlines 状态布尔值 标志。判断是否是a标签和是ie浏览器还是谷歌浏览器
 * @returns
 */
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
         *
         *
         * 总结
         * 1. 获取注释标签 --> 的索引
         * 2. 若存在-->的索引，判断options.shouldKeepComment是否保留注释
         * 3. 若options.shouldKeepComment为true，就将注释内容放入父元素的children属性中
         * 4. 剪切整个注释内容
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

            console.log(html, "=======注释结束========");
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
        const endTagMatch = html.match(endTag); /**比如: [</div>, div] */

        if (endTagMatch) {
          /**备份索引 */
          const curIndex = index;

          /**剪切结束标签 */
          advance(endTagMatch[0].length);

          /**
           * 处理结束标签
           * endTagMatch[1]: 标签名
           * curIndex: index
           * index: endTagMatch[0].length + index
           */
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

      /**如果 textEnd < 0，说明 html 中就没找到 <，那说明 html 就是一段文本 */
      if (textEnd < 0) {
        text = html;
      }

      /** 将文本内容从 html 模版字符串上截取掉 */
      if (text) {
        advance(text.length);
      }

      /**
       * 处理文本
       * 基于文本生成 ast 对象，然后将该 ast 放到它的父元素的肚子里，
       * 即 currentParent.children 数组中
       */
      if (options.chars && text) {
        options.chars(text, index - text.length, index);
      }
    } else {
      /**处理 script、style、textarea 标签的闭合标签 */
      let endTagLength = 0;

      /**开始标签的小写形式 */
      const stackedTag = lastTag.toLowerCase();
      const reStackedTag =
        reCache[stackedTag] ||
        (reCache[stackedTag] = new RegExp(
          "([\\s\\S]*?)(</" + stackedTag + "[^>]*>)",
          "i"
        ));
      /**匹配并处理开始标签和结束标签之间的所有文本，比如 <script>xx</script> */
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

    /** 到这里就处理结束，如果 stack 数组中还有内容，则说明有标签没有被闭合，给出提示信息 */
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
    /**
     * ["<div", "div"]
     */
    const start = html.match(startTagOpen);

    if (start) {
      /**处理结果 */
      const match = {
        /**标签名 比如div */
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
      advance(start[0].length); /**比如 id='app'> */

      let end, attr;

      /**
       * 处理开始标签内的各个属性，并将这些属性放到match.attrs数组中
       */
      while (
        !(end = html.match(startTagClose)) &&
        (attr = html.match(dynamicArgAttribute) || html.match(attribute))
      ) {
        /**[" class='name'", 'class', '=', 'name'] */

        /**属性开始的索引 */
        attr.start = index;
        /**裁切整个属性键值对 */
        advance(attr[0].length);
        /**属性结束的索引 */
        attr.end = index;
        /**
         * [
         *  ' id="app"',
         *  'id',
         *  '=',
         *  'app',
         *  end: 13,
         *  start: 4
         * ]
         */
        match.attrs.push(attr);
      }
      /**
       * 开始标签的结束，end=">"或者end=' />'
       *  处理开始标签的结束， 匹配> 或者 />
       **/
      if (end) {
        /**赋值自闭合标签 */
        match.unarySlash = end[1];
        /**删除> 或者/> */
        advance(end[0].length);
        /**设置结束索引 */
        match.end = index;
        /**返回结果 */
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
   * 总结：
   *  1. 获取tagName 标签名
   *  2. 获取自闭合标签
   *  3. 处理p标签
   *  4. 判断是否自闭合标签
   *  5. 创建属性数组，将属性对象转换成属性数组
   *  6. 如果不是自闭合标签， 将标签信息放到stack数组中，待处理他的闭合标签时在弹出stack数组
   *  7. 如果是自闭合标签， 标签信息不用放到stack数组中，直接处理众多属性，将他们都设置到 element ast 对象上，就没有处理 结束标签的那一步了，这一步在处理开始标签的过程中就进行了
   *  8. 调用 start 方法， 创建ast对象
   *
   * @param {*} match { attrs: [{ 0: " id='app'", 1: "id", 2: "=", 3: "app", end: 13, start: 4 }], end: 14, start: 0, tagName: "div", unarySlash: '' }
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
    /**数组属性对象转换正真正的数组对象 */
    const attrs = new Array(l);

    for (let i = 0; i < l; i++) {
      const args = match.attrs[i];
      /**依次取出匹配到的value值 */
      const value = args[3] || args[4] || args[5] || "";

      const shouldDecodeNewlines =
        tagName === "a" && args[1] === "href"
          ? options.shouldDecodeNewlinesForHref /** true chrome在a[href]中编码内容 */
          : options.shouldDecodeNewlines; /**false IE在属性值中编码换行，而其他浏览器则不会 */

      /** attrs[i] = { id: 'app' } */
      attrs[i] = {
        /**属性名称 */
        name: args[1],
        /**属性值 替换html 中的特殊符号，转义成js解析的字符串,替换 把   &lt;替换 <  ， &gt; 替换 > ， &quot;替换  "， &amp;替换 & ， &#10;替换\n  ，&#9;替换\t */
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
      /**
       * tagName: 标签名 div
       * attrs: 属性数组  {name: "id", value: "app", start: 5, end: 13}
       * unary: 是否为自闭合标签 false
       * match.start 标签开始位置 5
       * match.end 标签结束位置 13
       */
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
     *
     * Find the closest opened tag of the same type 查找最近打开的相同类型的标记
     */
    if (tagName) {
      /**结束标签名称，将字符串转化成小写  */
      lowerCasedTagName = tagName.toLowerCase();

      /**获取stack堆栈最近的匹配标签 */
      for (pos = stack.length - 1; pos >= 0; pos--) {
        /**找到最近的标签相等 */
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
        /**如果stack中找不到tagName 标签的时候就输出警告日志，找不到标签 */
        if (
          process.env.NODE_ENV !== "production" &&
          (i > pos || !tagName) &&
          options.warn
        ) {
          console.log(tagName, "==tagName", process.env.NODE_ENV, i > pos);
          options.warn(`tag <${stack[i].tag}> has no matching end tag.`, {
            start: stack[i].start,
            end: stack[i].end,
          });
        }

        /**
         * 调用options.end函数，删除当前节点的子节点中的最后一个如果是空格或者空的文本节点则删除，
         * 为stack出栈一个当前标签，为currentParent变量获取到当前节点的父节点
         *
         * 走到这里，说明上面的异常情况都处理完了，调用 options.end 处理正常的结束标签
         *
         **/
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

      /**
       * 标签开始函数， 创建一个ast标签dom，  判断获取v-for属性是否存在如果有则转义 v-for指令 把for，alias，iterator1，iterator2属性添加到虚拟dom中
       * 获取v-if属性，为el虚拟dom添加 v-if，v-eles，v-else-if 属性
       * 获取v-once 指令属性，如果有有该属性 为虚拟dom标签 标记事件 只触发一次则销毁
       * 校验属性的值，为el添加muted， events，nativeEvents，directives，  key， ref，slotName或者slotScope或者slot，component或者inlineTemplate 标志 属性
       * 标志当前的currentParent当前的 element
       * 为parse函数 stack标签堆栈 添加一个标签
       **/
      if (options.start) {
        options.start(tagName, [], true, start, end);
      }
    } else if (lowerCasedTagName === "p") {
      /**当前处理的标签为 <p> 标签 */
      if (options.start) {
        options.start(tagName, [], false, start, end);
      }

      if (options.end) {
        /**
         * 删除当前节点的子节点中的最后一个如果是空格或者空的文本节点则删除，
         * 为stack出栈一个当前标签，为currentParent变量获取到当前节点的父节点
         */
        options.end(tagName, start, end);
      }
    }
  }
}
