/**
 * Virtual DOM patching algorithm based on Snabbdom by
 * Simon Friis Vindum (@paldepind)
 * Licensed under the MIT License
 * https://github.com/paldepind/snabbdom/blob/master/LICENSE
 *
 * modified by Evan You (@yyx990803)
 *
 * Not type-checking this because this file is perf-critical and the cost
 * of making flow understand it is not worth it.
 */

import VNode, { cloneVNode } from "./vnode";
import config from "../config";
import { SSR_ATTR } from "shared/constants";
import { registerRef } from "./modules/ref";
import { traverse } from "../observer/traverse";
import { activeInstance } from "../instance/lifecycle";
import { isTextInputType } from "web/util/element";

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  makeMap,
  isRegExp,
  isPrimitive,
} from "../util/index";

export const emptyNode = new VNode("", {}, []);

const hooks = ["create", "activate", "update", "remove", "destroy"];

/**
 * v-for中key的作用
 *
 * 判读两个节点是否相同
 * @param {*} a
 * @param {*} b
 * @returns
 */
function sameVnode(a, b) {
  return (
    a.key ===
      b.key /** key 必须相同，需要注意的是 undefined === undefined => true */ &&
    a.asyncFactory === b.asyncFactory &&
    ((a.tag === b.tag /**标签相同 */ &&
      a.isComment === b.isComment /**都是注释节点 */ &&
      isDef(a.data) === isDef(b.data) /**都有 data 属性 */ &&
      sameInputType(a, b)) /**input 标签的情况 */ ||
      (isTrue(a.isAsyncPlaceholder) &&
        isUndef(b.asyncFactory.error))) /**异步占位符节点 */
  );
}

/**
 * 相同的输入类型。判断a和b的属性是否相同
 */
function sameInputType(a, b) {
  if (a.tag !== "input") return true;
  let i;
  /**获取a的tag标签属性 */
  const typeA = isDef((i = a.data)) && isDef((i = i.attrs)) && i.type;
  /**获取b的tag标签属性 */
  const typeB = isDef((i = b.data)) && isDef((i = i.attrs)) && i.type;
  return (
    typeA === typeB /**typeA和typeB 都相同 */ ||
    (isTextInputType(typeA) &&
      isTextInputType(
        typeB
      )) /**匹配'text,number,password,search,email,tel,url' */
  );
}

/**
 * 得到指定范围（beginIdx —— endIdx）内节点的 key 和 索引之间的关系映射 => { key1: idx1, ... }
 * @param {*} children
 * @param {*} beginIdx
 * @param {*} endIdx
 * @returns
 */
function createKeyToOldIdx(children, beginIdx, endIdx) {
  let i, key;
  const map = {};
  for (i = beginIdx; i <= endIdx; ++i) {
    /**节点的key */
    key = children[i].key;
    /**以节点的key为键，节点的下标为value，生成map对象 */
    if (isDef(key)) map[key] = i;
  }
  return map;
}

/**
 *  工厂函数，注入平台特有的一些功能操作，并定义一些方法，然后返回 patch 函数
 * @param {*} backend
 * @returns
 */
export function createPatchFunction(backend) {
  let i, j;
  const cbs = {};

  /**
   * var nodeOps = Object.freeze({
   *    createElement: createElement$1, //创建一个真实的dom
   *    createElementNS: createElementNS, //创建一个真实的dom svg方式
   *    createTextNode: createTextNode, // 创建文本节点
   *    createComment: createComment,  // 创建一个注释节点
   *    insertBefore: insertBefore,  //插入节点 在xxx  dom 前面插入一个节点
   *    removeChild: removeChild,   //删除子节点
   *    appendChild: appendChild,  //添加子节点 尾部
   *    parentNode: parentNode,  //获取父亲子节点dom
   *    nextSibling: nextSibling,     //获取下一个兄弟节点
   *    tagName: tagName,   //获取dom标签名称
   *    setTextContent: setTextContent, //  //设置dom 文本
   *    setStyleScope: setStyleScope  //设置组建样式的作用域
   *    });
   *    modules=[
   *      attrs,  // attrs包含两个方法create和update都是更新设置真实dom属性值 {create: updateAttrs,  update: updateAttrs   }
   *      klass, //klass包含类包含两个方法create和update都是更新calss。其实就是updateClass方法。 设置真实dom的class
   *      events, //更新真实dom的事件
   *      domProps, //更新真实dom的props 属性值
   *      style, // 更新真实dom的style属性。有两个方法create 和update 不过函数都是updateStyle更新真实dom的style属性值.将vonde虚拟dom的css 转义成并且渲染到真实dom的css中
   *      transition // 过度动画
   *      ref,  //ref创建，更新 ， 销毁 函数
   *      directives //自定义指令 创建 ，更新，销毁函数
   *    ]
   */

  /**
   * modules: { ref, directives, 平台特有的一些操纵，比如 attr、class、style 等 }
   * nodeOps: { 对元素的增删改查 API }
   */
  const { modules, nodeOps } = backend;

  /**
   * hooks = ['create', 'activate', 'update', 'remove', 'destroy']
   * 遍历这些钩子，然后从 modules 的各个模块中找到相应的方法，比如：directives 中的 create、update、destroy 方法
   * 让这些方法放到 cb[hook] = [hook 方法] 中，比如: cb.create = [fn1, fn2, ...]
   * 然后在合适的时间调用相应的钩子方法完成对应的操作
   */
  for (i = 0; i < hooks.length; ++i) {
    /**
     * 比如 cbs.create = []
     * cbs[create] = [各个模块的create钩子函数]
     **/
    cbs[hooks[i]] = [];
    for (j = 0; j < modules.length; ++j) {
      if (isDef(modules[j][hooks[i]])) {
        /**遍历各个 modules，找出各个 module 中的 create 方法，然后添加到 cbs.create 数组中 */
        cbs[hooks[i]].push(modules[j][hooks[i]]);
      }
    }
  }

  /**
   * 为元素(elm)创建一个空的 vnode
   * @param {*} elm
   * @returns
   */
  function emptyNodeAt(elm) {
    /**
     *  tag,  当前节点的标签名
     *  data, 当前节点对应的对象，包含了具体的一些数据信息，是一个VNodeData类型，可以参考VNodeData类型中的数据信息
     *  children, //子节点
     *  text, //文本
     *  elm, 当前节点
     *  context,  编译作用域
     *  componentOptions,  组件的option选
     *  asyncFactory
     */
    return new VNode(
      nodeOps.tagName(elm).toLowerCase(),
      {},
      [],
      undefined,
      elm
    );
  }

  /**
   *
   * @param {*} childElm  子节点
   * @param {*} listeners  事件数组
   * @returns
   */
  function createRmCb(childElm, listeners) {
    /**如果listeners === 0 的时候就删除掉该子节点 */
    function remove() {
      if (--remove.listeners === 0) {
        removeNode(childElm);
      }
    }
    remove.listeners = listeners;
    return remove;
  }

  /**
   * 删除真实的dom
   * @param {*} el
   */
  function removeNode(el) {
    /**获取父亲dom */
    const parent = nodeOps.parentNode(el);
    // element may have already been removed due to v-html / v-text
    if (isDef(parent)) {
      nodeOps.removeChild(parent, el);
    }
  }

  /**
   * 检查dom 节点的tag标签 类型 是否是VPre 标签 或者是判断是否是浏览器自带原有的标签
   * @param {*} vnode
   * @param {*} inVPre 标记 标签是否还有 v-pre 指令，如果没有则是false
   * @returns
   */
  function isUnknownElement(vnode, inVPre) {
    return (
      !inVPre &&
      !vnode.ns &&
      !(
        config.ignoredElements.length &&
        config.ignoredElements.some((ignore) => {
          return isRegExp(ignore) /**判断是否是正则对象 */
            ? ignore.test(vnode.tag)
            : ignore === vnode.tag;
        })
      ) &&
      /**判断是不是真的是 html 原有的标签，判断是否是浏览器标准标签 */
      config.isUnknownElement(vnode.tag)
    );
  }

  let creatingElmInVPre = 0;

  /**
   * 基于 vnode 创建整棵 DOM 树，并插入到父节点上
   * @param {*} vnode 节点
   * @param {*} insertedVnodeQueue 插入Vnode队列
   * @param {*} parentElm 父亲节点
   * @param {*} refElm 当前的节点的兄弟节点
   * @param {*} nested 嵌套
   * @param {*} ownerArray 主数组节点
   * @param {*} index 索引
   * @returns
   */
  function createElm(
    vnode,
    insertedVnodeQueue,
    parentElm,
    refElm,
    nested,
    ownerArray,
    index
  ) {
    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // This vnode was used in a previous render!
      // now it's used as a new node, overwriting its elm would cause
      // potential patch errors down the road when it's used as an insertion
      // reference node. Instead, we clone the node on-demand before creating
      // associated DOM element for it.
      vnode = ownerArray[index] = cloneVNode(vnode);
    }

    vnode.isRootInsert = !nested; // for transition enter check

    /**
     * 重点
     *  1、如果 vnode 是一个组件，则执行 init 钩子，创建组件实例并挂载，然后为组件执行各个模块的 create 钩子
     *  2、如果组件被 keep-alive 包裹，则激活组件
     *  3、如果是一个普通元素，则什么也不做
     */
    if (createComponent(vnode, insertedVnodeQueue, parentElm, refElm)) {
      return;
    }

    /**获取data对象 */
    const data = vnode.data;

    /**获取所有子节点 */
    const children = vnode.children;

    /**获取节点的标签 */
    const tag = vnode.tag;

    if (isDef(tag)) {
      if (process.env.NODE_ENV !== "production") {
        if (data && data.pre) {
          creatingElmInVPre++;
        }
        /*未知标签 */
        if (isUnknownElement(vnode, creatingElmInVPre)) {
          warn(
            "Unknown custom element: <" +
              tag +
              "> - did you " +
              "register the component correctly? For recursive components, " +
              'make sure to provide the "name" option.',
            vnode.context
          );
        }
      }

      /**创建DOM新节点 */
      vnode.elm = vnode.ns
        ? nodeOps.createElementNS(
            vnode.ns,
            tag
          ) /**字符串值，可为此元素节点规定命名空间的名称。 可能是svg 或者 math 节点 */
        : nodeOps.createElement(tag, vnode) /**html创建一个dom 节点 */;

      /**设置样式的作用域 */
      setScope(vnode);

      /* istanbul ignore if */
      if (__WEEX__) {
        // in Weex, the default insertion order is parent-first.
        // List items can be optimized to use children-first insertion
        // with append="tree".
        const appendAsTree = isDef(data) && isTrue(data.appendAsTree);
        if (!appendAsTree) {
          if (isDef(data)) {
            invokeCreateHooks(vnode, insertedVnodeQueue);
          }
          insert(parentElm, vnode.elm, refElm);
        }
        createChildren(vnode, children, insertedVnodeQueue);
        if (appendAsTree) {
          if (isDef(data)) {
            invokeCreateHooks(vnode, insertedVnodeQueue);
          }
          insert(parentElm, vnode.elm, refElm);
        }
      } else {
        /**递归创建所有子节点(普通元素，组件)，生成整棵DOM树 */
        createChildren(vnode, children, insertedVnodeQueue);
        if (isDef(data)) {
          /**
           * 循环cbs.create 钩子函数，并且执行调用，其实cbs.create 钩子函数就是platformModules中的attrs中 updateAttrs更新属性函数。
           * 如果是组件则调用componentVNodeHooks中的 create
           **/
          invokeCreateHooks(vnode, insertedVnodeQueue);
        }
        /**将节点插入父节点 */
        insert(parentElm, vnode.elm, refElm);
      }

      if (process.env.NODE_ENV !== "production" && data && data.pre) {
        creatingElmInVPre--;
      }
    } else if (isTrue(vnode.isComment)) {
      /**注释节点， 创建注释节点并插入父节点 */
      vnode.elm = nodeOps.createComment(vnode.text);
      insert(parentElm, vnode.elm, refElm);
    } else {
      /**文本节点，创建文本节点并插入父节点 */
      vnode.elm = nodeOps.createTextNode(vnode.text);
      insert(parentElm, vnode.elm, refElm);
    }
  }

  /**
   * 如果 vnode 是一个组件，则执行 init 钩子，创建组件实例，并挂载
   * 然后为组件执行各个模块的 create 方法
   * @param {*} vnode 组件新的 vnode
   * @param {*} insertedVnodeQueue 数组
   * @param {*} parentElm oldVnode 的父节点
   * @param {*} refElm oldVnode 的下一个兄弟节点
   * @returns 如果 vnode 是一个组件并且组件创建成功，则返回 true，否则返回 undefined
   */
  function createComponent(vnode, insertedVnodeQueue, parentElm, refElm) {
    /**获取 vnode.data 对象 */
    let i = vnode.data;

    if (isDef(i)) {
      /**验证组件实例是否已经存在 && 被 keep-alive 包裹 */
      const isReactivated = isDef(vnode.componentInstance) && i.keepAlive;

      /**
       * 执行 vnode.data.init 钩子函数，该函数在讲 render helper 时讲过
       * 如果是被 keep-alive 包裹的组件：则再执行 prepatch 钩子，用 vnode 上的各个属性更新 oldVnode 上的相关属性
       * 如果是组件没有被 keep-alive 包裹或者首次渲染，则初始化组件，并进入挂载阶段
       */
      if (isDef((i = i.hook)) && isDef((i = i.init))) {
        i(vnode, false /* hydrating */);
      }
      // after calling the init hook, if the vnode is a child component
      // it should've created a child instance and mounted it. the child
      // component also has set the placeholder vnode's elm.
      // in that case we can just return the element and be done.
      if (isDef(vnode.componentInstance)) {
        /**
         * 如果 vnode 是一个子组件，则调用 init 钩子之后会创建一个组件实例，并挂载
         * 这时候就可以给组件执行各个模块的的 create 钩子了
         */
        initComponent(vnode, insertedVnodeQueue);

        /**
         * 将组件的 DOM 节点插入到父节点内
         */
        insert(parentElm, vnode.elm, refElm);
        if (isTrue(isReactivated)) {
          /**组件被 keep-alive 包裹的情况，激活组件 */
          reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm);
        }
        return true;
      }
    }
  }

  /**
   *  初始化组建，如果没有tag标签则去更新真实dom的属性，如果有tag标签，则注册或者删除ref 然后为insertedVnodeQueue.push(vnode);确保调用插入钩子如果vnode.data.pendingInsert为反正则也为insertedVnodeQueue插入缓存 vnode.data.pendingInsert
   * @param {*} vnode
   * @param {*} insertedVnodeQueue 插入Vnode队列 记录已经实例化过的组件
   */
  function initComponent(vnode, insertedVnodeQueue) {
    if (isDef(vnode.data.pendingInsert)) {
      /**模板缓存 待插入 */
      insertedVnodeQueue.push.apply(
        insertedVnodeQueue,
        vnode.data.pendingInsert
      );
      vnode.data.pendingInsert = null;
    }
    /**组件实例 */
    vnode.elm = vnode.componentInstance.$el;
    if (isPatchable(vnode)) {
      /**
       * 判断组件是否定义有 tag标签
       * 为组件执行各个模块的 create 钩子函数
       * 通过常规属性修补过程。
       */
      invokeCreateHooks(vnode, insertedVnodeQueue);

      /**
       * 为有作用域的CSS设置作用域id属性。
       * 这是作为一种特殊情况来实现的，以避免开销
       */
      setScope(vnode);
    } else {
      // empty component root.
      // skip all element-related modules except for ref (#3455)
      registerRef(vnode);
      // make sure to invoke the insert hook
      insertedVnodeQueue.push(vnode);
    }
  }

  function reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm) {
    let i;
    // hack for #4339: a reactivated component with inner transition
    // does not trigger because the inner node's created hooks are not called
    // again. It's not ideal to involve module-specific logic in here but
    // there doesn't seem to be a better way to do it.
    let innerNode = vnode;
    while (innerNode.componentInstance) {
      innerNode = innerNode.componentInstance._vnode;
      if (isDef((i = innerNode.data)) && isDef((i = i.transition))) {
        for (i = 0; i < cbs.activate.length; ++i) {
          cbs.activate[i](emptyNode, innerNode);
        }
        insertedVnodeQueue.push(innerNode);
        break;
      }
    }
    // unlike a newly created component,
    // a reactivated keep-alive component doesn't insert itself
    insert(parentElm, vnode.elm, refElm);
  }

  /**
   * 向父节点插入节点
   * @param {*} parent
   * @param {*} elm
   * @param {*} ref
   */
  function insert(parent, elm, ref) {
    if (isDef(parent)) {
      if (isDef(ref)) {
        if (nodeOps.parentNode(ref) === parent) {
          nodeOps.insertBefore(parent, elm, ref);
        }
      } else {
        nodeOps.appendChild(parent, elm);
      }
    }
  }

  /**
   * 创建所有子节点，并将子节点插入父节点，形成一棵 DOM 树
   * @param {*} vnode
   * @param {*} children
   * @param {*} insertedVnodeQueue
   */
  function createChildren(vnode, children, insertedVnodeQueue) {
    if (Array.isArray(children)) {
      /** children 是数组，表示是一组节点 */
      if (process.env.NODE_ENV !== "production") {
        /**检测这组节点的 key 是否重复 */
        checkDuplicateKeys(children);
      }
      /**遍历这组节点，依次创建这些节点然后插入父节点，形成一棵 DOM 树 */
      for (let i = 0; i < children.length; ++i) {
        createElm(
          children[i],
          insertedVnodeQueue,
          vnode.elm,
          null,
          true,
          children,
          i
        );
      }
    } else if (isPrimitive(vnode.text)) {
      /**说明是文本节点，创建文本节点，并插入父节点 */
      nodeOps.appendChild(
        vnode.elm,
        nodeOps.createTextNode(String(vnode.text))
      );
    }
  }

  function isPatchable(vnode) {
    while (vnode.componentInstance) {
      vnode = vnode.componentInstance._vnode;
    }
    return isDef(vnode.tag);
  }

  /**
   * 调用 各个模块的 create 方法，比如创建属性的、创建样式的、指令的等等 ，然后执行组件的 mounted 生命周期方法
   * @param {*} vnode
   * @param {*} insertedVnodeQueue
   */
  function invokeCreateHooks(vnode, insertedVnodeQueue) {
    for (let i = 0; i < cbs.create.length; ++i) {
      cbs.create[i](emptyNode, vnode);
    }
    /**组件钩子 */
    i = vnode.data.hook; // Reuse variable
    if (isDef(i)) {
      /**组件好像没有 create 钩子 */
      if (isDef(i.create)) i.create(emptyNode, vnode);
      /**调用组件的 insert 钩子，执行组件的 mounted 生命周期方法 */
      if (isDef(i.insert)) insertedVnodeQueue.push(vnode);
    }
  }

  // set scope id attribute for scoped CSS.
  // this is implemented as a special case to avoid the overhead
  // of going through the normal attribute patching process.
  function setScope(vnode) {
    let i;
    /**fnScopeId 判断css作用 有没有设置Scope 如果有则设置 css作用域 */
    if (isDef((i = vnode.fnScopeId))) {
      nodeOps.setStyleScope(vnode.elm, i);
    } else {
      let ancestor = vnode;
      while (ancestor) {
        if (isDef((i = ancestor.context)) && isDef((i = i.$options._scopeId))) {
          nodeOps.setStyleScope(vnode.elm, i);
        }
        ancestor = ancestor.parent;
      }
    }
    // for slot content they should also get the scopeId from the host instance.
    /**
     * context, 编译作用域
     * 上下文 判断vnode 是否设置有作用于 与css是否设置有作用域 _scopeId 是放在dom属性上面做标记
     */
    if (
      isDef((i = activeInstance)) &&
      i !== vnode.context &&
      i !== vnode.fnContext &&
      isDef((i = i.$options._scopeId))
    ) {
      nodeOps.setStyleScope(vnode.elm, i);
    }
  }

  /**
   *  在指定索引范围（startIdx —— endIdx）内添加节点
   * @param {*} parentElm 父亲节点
   * @param {*} refElm 当前点
   * @param {*} vnodes 虚拟dom
   * @param {*} startIdx 开始index
   * @param {*} endIdx 结束index
   * @param {*} insertedVnodeQueue 插入Vnode队列
   */
  function addVnodes(
    parentElm,
    refElm,
    vnodes,
    startIdx,
    endIdx,
    insertedVnodeQueue
  ) {
    for (; startIdx <= endIdx; ++startIdx) {
      createElm(
        vnodes[startIdx],
        insertedVnodeQueue,
        parentElm,
        refElm,
        false,
        vnodes,
        startIdx
      );
    }
  }

  /**
   * 销毁节点：
   *  执行组件的 destroy 钩子，即执行 $destroy 方法
   *  执行组件各个模块(style、class、directive 等）的 destroy 方法
   *  如果 vnode 还存在子节点，则递归调用 invokeDestroyHook
   *
   *  组件钩子函数/src/vnode/core/vdom/create-component
   * @param {*} vnode
   */
  function invokeDestroyHook(vnode) {
    let i, j;
    /**获取data对象 */
    const data = vnode.data;
    if (isDef(data)) {
      /**执行data.hook.destroy 钩子 */
      if (isDef((i = data.hook)) && isDef((i = i.destroy))) i(vnode);
      for (i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode);
    }
    /**递归销毁所有子节点 */
    if (isDef((i = vnode.children))) {
      for (j = 0; j < vnode.children.length; ++j) {
        invokeDestroyHook(vnode.children[j]);
      }
    }
  }

  /**
   * 移除指定索引范围（startIdx —— endIdx）内的节点
   * @param {*} vnodes
   * @param {*} startIdx
   * @param {*} endIdx
   */
  function removeVnodes(vnodes, startIdx, endIdx) {
    for (; startIdx <= endIdx; ++startIdx) {
      const ch = vnodes[startIdx];
      if (isDef(ch)) {
        if (isDef(ch.tag)) {
          removeAndInvokeRemoveHook(ch);
          invokeDestroyHook(ch);
        } else {
          // Text node
          removeNode(ch.elm);
        }
      }
    }
  }

  function removeAndInvokeRemoveHook(vnode, rm) {
    if (isDef(rm) || isDef(vnode.data)) {
      let i;
      const listeners = cbs.remove.length + 1;
      if (isDef(rm)) {
        // we have a recursively passed down rm callback
        // increase the listeners count
        rm.listeners += listeners;
      } else {
        // directly removing
        rm = createRmCb(vnode.elm, listeners);
      }
      // recursively invoke hooks on child component root node
      if (
        isDef((i = vnode.componentInstance)) &&
        isDef((i = i._vnode)) &&
        isDef(i.data)
      ) {
        removeAndInvokeRemoveHook(i, rm);
      }
      for (i = 0; i < cbs.remove.length; ++i) {
        cbs.remove[i](vnode, rm);
      }
      if (isDef((i = vnode.data.hook)) && isDef((i = i.remove))) {
        i(vnode, rm);
      } else {
        rm();
      }
    } else {
      removeNode(vnode.elm);
    }
  }

  /**
   * diff 过程:
   *      diff 优化：做了四种假设，假设新老节点开头结尾有相同节点的情况，一旦命中假设，就避免了一次循环，以提高执行效率
   *                如果不幸没有命中假设，则执行遍历，从老节点中找到新开始节点
   *                找到相同节点，则执行 patchVnode，然后将老节点移动到正确的位置
   *      如果老节点先于新节点遍历结束，则剩余的新节点执行新增节点操作
   *      如果新节点先于老节点遍历结束，则剩余的老节点执行删除操作，移除这些老节点
   * @param {*} parentElm
   * @param {*} oldCh
   * @param {*} newCh
   * @param {*} insertedVnodeQueue
   * @param {*} removeOnly
   */
  function updateChildren(
    parentElm,
    oldCh,
    newCh,
    insertedVnodeQueue,
    removeOnly
  ) {
    /**旧节点的开始索引 */
    let oldStartIdx = 0;

    /**新节点的开始索引 */
    let newStartIdx = 0;

    /**旧节点的结束索引 */
    let oldEndIdx = oldCh.length - 1;

    /**第一个旧节点 */
    let oldStartVnode = oldCh[0];

    /**最后一个旧节点 */
    let oldEndVnode = oldCh[oldEndIdx];

    /**新节点的开始索引 */
    let newEndIdx = newCh.length - 1;

    /**第一个新节点 */
    let newStartVnode = newCh[0];

    /**最后一个新节点 */
    let newEndVnode = newCh[newEndIdx];

    let oldKeyToIdx, idxInOld, vnodeToMove, refElm;

    // removeOnly is a special flag used only by <transition-group>
    // to ensure removed elements stay in correct relative positions
    // during leaving transitions
    /** removeOnly是一个特殊的标志，仅由 <transition-group> 使用，以确保被移除的元素在离开转换期间保持在正确的相对位置 */
    const canMove = !removeOnly;

    if (process.env.NODE_ENV !== "production") {
      /**检查新节点的 key 是否重复 */
      checkDuplicateKeys(newCh);
    }

    /**
     * 假设：
     *  1. 新开始节点和老开始节点是同一个节点， 然后去做对比更新
     *  2. 老结束节点和新结束节点是同一个节点
     *  3. 老开始节点和新结束节点是同一个节点
     *  4. 新开始节点和老结束节点是同一个节点
     *
     *  假设四种假设都没有命中， 只能挨个遍历，一次调整结束，更新这四个指针
     *
     *  遍历新老两组节点，只要有一组遍历完（开始索引超过结束索引）则跳出循环
     */
    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      if (isUndef(oldStartVnode)) {
        /**
         * 如果当前节点不存在，则移动指针
         * 如果节点被移动，在当前索引上可能不存在，检测这种情况，如果节点不存在则调整索引
         */
        oldStartVnode = oldCh[++oldStartIdx]; // Vnode has been moved left
      } else if (isUndef(oldEndVnode)) {
        /**
         * 如果当前节点不存在，则移动指针
         * 如果节点被移动，在当前索引上可能不存在，检测这种情况，如果节点不存在则调整索引
         */
        oldEndVnode = oldCh[--oldEndIdx];
      } else if (sameVnode(oldStartVnode, newStartVnode)) {
        /**
         * 老开始节点和新开始节点是同一个节点，执行 patch 节点更新
         */
        patchVnode(
          oldStartVnode,
          newStartVnode,
          insertedVnodeQueue,
          newCh,
          newStartIdx
        );

        /**patch 结束后老开始和新开始的索引分别加 1 */
        oldStartVnode = oldCh[++oldStartIdx];
        newStartVnode = newCh[++newStartIdx];
      } else if (sameVnode(oldEndVnode, newEndVnode)) {
        /**老结束和新结束是同一个节点，执行 patch */
        patchVnode(
          oldEndVnode,
          newEndVnode,
          insertedVnodeQueue,
          newCh,
          newEndIdx
        );

        /**patch 结束后老结束和新结束的索引分别减 1 */
        oldEndVnode = oldCh[--oldEndIdx];
        newEndVnode = newCh[--newEndIdx];
      } else if (sameVnode(oldStartVnode, newEndVnode)) {
        /**老开始和新结束是同一个节点，执行 patch  Vnode moved right*/
        patchVnode(
          oldStartVnode,
          newEndVnode,
          insertedVnodeQueue,
          newCh,
          newEndIdx
        );

        /**移动节点 */
        canMove &&
          nodeOps.insertBefore(
            parentElm,
            oldStartVnode.elm,
            nodeOps.nextSibling(oldEndVnode.elm)
          );

        /**patch 结束后老开始索引加 1，新结束索引减 1 */
        oldStartVnode = oldCh[++oldStartIdx];
        newEndVnode = newCh[--newEndIdx];
      } else if (sameVnode(oldEndVnode, newStartVnode)) {
        /** 老结束和新开始是同一个节点，执行 patch Vnode moved left */
        patchVnode(
          oldEndVnode,
          newStartVnode,
          insertedVnodeQueue,
          newCh,
          newStartIdx
        );

        /**移动节点 */
        canMove &&
          nodeOps.insertBefore(parentElm, oldEndVnode.elm, oldStartVnode.elm);

        /**patch 结束后，老结束的索引减 1，新开始的索引加 1 */
        oldEndVnode = oldCh[--oldEndIdx];
        newStartVnode = newCh[++newStartIdx];
      } else {
        /**如果上面的四种假设都不成立，则通过遍历找到新开始节点在老节点中的位置索引 */

        /**
         * 找到老节点中每个节点 key 和 索引之间的关系映射 => oldKeyToIdx = { key1: idx1, ... }
         * 生成老节点的map对象， 以节点的key为键，节点的下标为value, {key: idx}
         */
        if (isUndef(oldKeyToIdx))
          oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx);

        /**
         * 在映射中找到新开始节点在老节点中的位置索引
         * 从老节点的map对象中根据节点的key找到新开始节点在老节点数组中对应的下标
         */
        idxInOld = isDef(newStartVnode.key)
          ? oldKeyToIdx[newStartVnode.key]
          : findIdxInOld(newStartVnode, oldCh, oldStartIdx, oldEndIdx);

        if (isUndef(idxInOld)) {
          /**
           * 如果下标不存在，在老节点中没找到新开始节点，则说明是新创建的元素，执行创建 New element
           **/
          createElm(
            newStartVnode,
            insertedVnodeQueue,
            parentElm,
            oldStartVnode.elm,
            false,
            newCh,
            newStartIdx
          );
        } else {
          /**存在下标，在老节点中找到新开始节点了 */
          vnodeToMove = oldCh[idxInOld];

          if (sameVnode(vnodeToMove, newStartVnode)) {
            /**如果这两个节点是同一个，则执行 patch，然后移动节点*/
            patchVnode(
              vnodeToMove,
              newStartVnode,
              insertedVnodeQueue,
              newCh,
              newStartIdx
            );

            /**patch 结束后将该老节点置为 undefined */
            oldCh[idxInOld] = undefined;

            /**移动节点 */
            canMove &&
              nodeOps.insertBefore(
                parentElm,
                vnodeToMove.elm,
                oldStartVnode.elm
              );
          } else {
            /**
             * 最后这种情况是，找到节点了，但是发现两个节点不是同一个节点，则视为新元素，执行创建
             * 新老节点key相同，但却不是同一个节点，则认为新节点是新增的，执行创建
             * same key but different element. treat as new element
             */
            createElm(
              newStartVnode,
              insertedVnodeQueue,
              parentElm,
              oldStartVnode.elm,
              false,
              newCh,
              newStartIdx
            );
          }
        }
        /**老节点向后移动一个 */
        newStartVnode = newCh[++newStartIdx];
      }
    }
    /**走到这里，说明老姐节点或者新节点被遍历完了 */
    if (oldStartIdx > oldEndIdx) {
      /**
       * 老开始指针大于老结束指针
       * 说明老节点被遍历完了，新节点有剩余，则说明这部分剩余的节点是新增的节点，然后添加这些节点
       **/
      refElm = isUndef(newCh[newEndIdx + 1]) ? null : newCh[newEndIdx + 1].elm;
      addVnodes(
        parentElm,
        refElm,
        newCh,
        newStartIdx,
        newEndIdx,
        insertedVnodeQueue
      );
    } else if (newStartIdx > newEndIdx) {
      /**
       * 说明新节点被遍历完了，老节点有剩余，说明这部分的节点被删掉了，则移除这些节点
       **/
      removeVnodes(oldCh, oldStartIdx, oldEndIdx);
    }
  }

  /**
   * 检查一组元素的 key 是否重复
   * @param {*} children
   */
  function checkDuplicateKeys(children) {
    const seenKeys = {};
    for (let i = 0; i < children.length; i++) {
      const vnode = children[i];
      const key = vnode.key;
      if (isDef(key)) {
        if (seenKeys[key]) {
          warn(
            `Duplicate keys detected: '${key}'. This may cause an update error.`,
            vnode.context
          );
        } else {
          seenKeys[key] = true;
        }
      }
    }
  }

  /**
   * 找到新节点（vnode）在老节点（oldCh）中的位置索引
   * @param {*} node
   * @param {*} oldCh
   * @param {*} start
   * @param {*} end
   * @returns
   */
  function findIdxInOld(node, oldCh, start, end) {
    for (let i = start; i < end; i++) {
      const c = oldCh[i];
      if (isDef(c) && sameVnode(node, c)) return i;
    }
  }

  /**
   * 更新节点
   *    全量的属性更新
   *    如果新老节点都有孩子，则递归执行 diff
   *    如果新节点有孩子，老节点没孩子，则新增新节点的这些孩子节点
   *    如果老节点有孩子，新节点没孩子，则删除老节点的这些孩子
   *    更新文本节点
   * @param {*} oldVnode
   * @param {*} vnode
   * @param {*} insertedVnodeQueue
   * @param {*} ownerArray
   * @param {*} index
   * @param {*} removeOnly
   * @returns
   */
  function patchVnode(
    oldVnode,
    vnode,
    insertedVnodeQueue,
    ownerArray,
    index,
    removeOnly
  ) {
    /**老节点和新节点相同，直接返回 */
    if (oldVnode === vnode) {
      return;
    }

    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // clone reused vnode
      vnode = ownerArray[index] = cloneVNode(vnode);
    }

    const elm = (vnode.elm = oldVnode.elm);

    /**异步占位符节点 */
    if (isTrue(oldVnode.isAsyncPlaceholder)) {
      if (isDef(vnode.asyncFactory.resolved)) {
        hydrate(oldVnode.elm, vnode, insertedVnodeQueue);
      } else {
        vnode.isAsyncPlaceholder = true;
      }
      return;
    }

    /**跳过静态节点的更新 */
    // reuse element for static trees.
    // note we only do this if the vnode is cloned -
    // if the new node is not cloned it means the render functions have been
    // reset by the hot-reload-api and we need to do a proper re-render.
    if (
      isTrue(vnode.isStatic) &&
      isTrue(oldVnode.isStatic) &&
      vnode.key === oldVnode.key &&
      (isTrue(vnode.isCloned) || isTrue(vnode.isOnce))
    ) {
      /**新旧节点都是静态的而且两个节点的 key 一样，并且新节点被 clone 了 或者 新节点有 v-once指令，则重用这部分节点*/
      vnode.componentInstance = oldVnode.componentInstance;
      return;
    }

    /**执行组件的 prepatch 钩子 */
    let i;
    const data = vnode.data;
    if (isDef(data) && isDef((i = data.hook)) && isDef((i = i.prepatch))) {
      i(oldVnode, vnode);
    }

    /**老节点的所有子节点 */
    const oldCh = oldVnode.children;

    /**新节点的所有子节点 */
    const ch = vnode.children;

    /**全量更新新节点的属性，Vue 3.0 在这里做了很多的优化，引入了一个block的概念 */
    if (isDef(data) && isPatchable(vnode)) {
      /**执行新节点所有的属性更新 */
      for (i = 0; i < cbs.update.length; ++i) cbs.update[i](oldVnode, vnode);
      if (isDef((i = data.hook)) && isDef((i = i.update))) i(oldVnode, vnode);
    }

    if (isUndef(vnode.text)) {
      /**新节点不是文本节点 */
      if (isDef(oldCh) && isDef(ch)) {
        if (oldCh !== ch)
          /**如果新老节点都有孩子，则递归执行 diff 过程 */
          updateChildren(elm, oldCh, ch, insertedVnodeQueue, removeOnly);
      } else if (isDef(ch)) {
        /** 老孩子不存在，新孩子存在，说明新增孩子节点，则创建这些新孩子节点 */
        if (process.env.NODE_ENV !== "production") {
          checkDuplicateKeys(ch);
        }
        if (isDef(oldVnode.text)) nodeOps.setTextContent(elm, "");
        addVnodes(elm, null, ch, 0, ch.length - 1, insertedVnodeQueue);
      } else if (isDef(oldCh)) {
        /**老孩子存在，新孩子不存在，则移除这些老孩子节点 */
        removeVnodes(oldCh, 0, oldCh.length - 1);
      } else if (isDef(oldVnode.text)) {
        /**老节点是文本节点，则将文本内容置空 */
        nodeOps.setTextContent(elm, "");
      }
    } else if (oldVnode.text !== vnode.text) {
      /**新老节点是文本节点且文本发生了改变，则更新文本节点 */
      nodeOps.setTextContent(elm, vnode.text);
    }
    if (isDef(data)) {
      if (isDef((i = data.hook)) && isDef((i = i.postpatch)))
        i(oldVnode, vnode);
    }
  }

  function invokeInsertHook(vnode, queue, initial) {
    // delay insert hooks for component root nodes, invoke them after the
    // element is really inserted
    if (isTrue(initial) && isDef(vnode.parent)) {
      vnode.parent.data.pendingInsert = queue;
    } else {
      for (let i = 0; i < queue.length; ++i) {
        queue[i].data.hook.insert(queue[i]);
      }
    }
  }

  let hydrationBailed = false;
  // list of modules that can skip create hook during hydration because they
  // are already rendered on the client or has no need for initialization
  // Note: style is excluded because it relies on initial clone for future
  // deep updates (#7063).
  const isRenderedModule = makeMap("attrs,class,staticClass,staticStyle,key");

  // Note: this is a browser-only function so we can assume elms are DOM nodes.
  function hydrate(elm, vnode, insertedVnodeQueue, inVPre) {
    let i;
    const { tag, data, children } = vnode;
    inVPre = inVPre || (data && data.pre);
    vnode.elm = elm;

    if (isTrue(vnode.isComment) && isDef(vnode.asyncFactory)) {
      vnode.isAsyncPlaceholder = true;
      return true;
    }
    // assert node match
    if (process.env.NODE_ENV !== "production") {
      if (!assertNodeMatch(elm, vnode, inVPre)) {
        return false;
      }
    }
    if (isDef(data)) {
      if (isDef((i = data.hook)) && isDef((i = i.init)))
        i(vnode, true /* hydrating */);
      if (isDef((i = vnode.componentInstance))) {
        // child component. it should have hydrated its own tree.
        initComponent(vnode, insertedVnodeQueue);
        return true;
      }
    }
    if (isDef(tag)) {
      if (isDef(children)) {
        // empty element, allow client to pick up and populate children
        if (!elm.hasChildNodes()) {
          createChildren(vnode, children, insertedVnodeQueue);
        } else {
          // v-html and domProps: innerHTML
          if (
            isDef((i = data)) &&
            isDef((i = i.domProps)) &&
            isDef((i = i.innerHTML))
          ) {
            if (i !== elm.innerHTML) {
              /* istanbul ignore if */
              if (
                process.env.NODE_ENV !== "production" &&
                typeof console !== "undefined" &&
                !hydrationBailed
              ) {
                hydrationBailed = true;
                console.warn("Parent: ", elm);
                console.warn("server innerHTML: ", i);
                console.warn("client innerHTML: ", elm.innerHTML);
              }
              return false;
            }
          } else {
            // iterate and compare children lists
            let childrenMatch = true;
            let childNode = elm.firstChild;
            for (let i = 0; i < children.length; i++) {
              if (
                !childNode ||
                !hydrate(childNode, children[i], insertedVnodeQueue, inVPre)
              ) {
                childrenMatch = false;
                break;
              }
              childNode = childNode.nextSibling;
            }
            // if childNode is not null, it means the actual childNodes list is
            // longer than the virtual children list.
            if (!childrenMatch || childNode) {
              /* istanbul ignore if */
              if (
                process.env.NODE_ENV !== "production" &&
                typeof console !== "undefined" &&
                !hydrationBailed
              ) {
                hydrationBailed = true;
                console.warn("Parent: ", elm);
                console.warn(
                  "Mismatching childNodes vs. VNodes: ",
                  elm.childNodes,
                  children
                );
              }
              return false;
            }
          }
        }
      }
      if (isDef(data)) {
        let fullInvoke = false;
        for (const key in data) {
          if (!isRenderedModule(key)) {
            fullInvoke = true;
            invokeCreateHooks(vnode, insertedVnodeQueue);
            break;
          }
        }
        if (!fullInvoke && data["class"]) {
          // ensure collecting deps for deep class bindings for future updates
          traverse(data["class"]);
        }
      }
    } else if (elm.data !== vnode.text) {
      elm.data = vnode.text;
    }
    return true;
  }

  function assertNodeMatch(node, vnode, inVPre) {
    if (isDef(vnode.tag)) {
      return (
        vnode.tag.indexOf("vue-component") === 0 ||
        (!isUnknownElement(vnode, inVPre) &&
          vnode.tag.toLowerCase() ===
            (node.tagName && node.tagName.toLowerCase()))
      );
    } else {
      return node.nodeType === (vnode.isComment ? 8 : 3);
    }
  }

  /**
   * vm.__patch__
   *   1、新节点不存在，老节点存在，调用 destroy，销毁老节点
   *   2、如果 oldVnode 是真实元素，则表示首次渲染，创建新节点，并插入 body，然后移除老节点
   *   3、如果 oldVnode 不是真实元素，则表示更新阶段，执行 patchVnode
   */
  return function patch(oldVnode, vnode, hydrating, removeOnly) {
    /**如果新节点不存在，老节点存在，则调用 destroy，销毁老节点 */
    if (isUndef(vnode)) {
      if (isDef(oldVnode)) invokeDestroyHook(oldVnode);
      return;
    }

    let isInitialPatch = false;
    const insertedVnodeQueue = [];

    if (isUndef(oldVnode)) {
      /**
       * 新的 VNode 存在，老的 VNode 不存在
       * 这种情况会在一个组件初次渲染的时候出现，比如：
       *  <div id="app"><comp></comp></div>
       * 这里的 comp 组件初次渲染时就会走这儿
       * empty mount (likely as component), create new root element
       */
      isInitialPatch = true;
      createElm(vnode, insertedVnodeQueue);
    } else {
      /**
       * 判断 oldVnode 是否为真实元素
       **/
      const isRealElement = isDef(oldVnode.nodeType);

      if (!isRealElement && sameVnode(oldVnode, vnode)) {
        /**
         * patch existing root node
         * 不是真实元素，但是老节点和新节点是同一个节点，则是更新阶段，执行 patch 更新节点
         * 比较新老节点
         */
        patchVnode(oldVnode, vnode, insertedVnodeQueue, null, null, removeOnly);
      } else {
        /**是真实元素，则表示初次渲染 */
        if (isRealElement) {
          /**挂载到真实元素以及处理服务端渲染的情况 */
          // mounting to a real element
          // check if this is server-rendered content and if we can perform
          // a successful hydration.
          if (oldVnode.nodeType === 1 && oldVnode.hasAttribute(SSR_ATTR)) {
            oldVnode.removeAttribute(SSR_ATTR);
            hydrating = true;
          }
          if (isTrue(hydrating)) {
            if (hydrate(oldVnode, vnode, insertedVnodeQueue)) {
              invokeInsertHook(vnode, insertedVnodeQueue, true);
              return oldVnode;
            } else if (process.env.NODE_ENV !== "production") {
              warn(
                "The client-side rendered virtual DOM tree is not matching " +
                  "server-rendered content. This is likely caused by incorrect " +
                  "HTML markup, for example nesting block-level elements inside " +
                  "<p>, or missing <tbody>. Bailing hydration and performing " +
                  "full client-side render."
              );
            }
          }
          // either not server-rendered, or hydration failed.
          // create an empty node and replace it
          /**
           * 走到这儿说明不是服务端渲染，或者 hydration 失败，
           * 则根据 oldVnode ，也就是真实节点创建一个 vnode 节点
           **/
          oldVnode = emptyNodeAt(oldVnode);
        }

        // replacing existing element  拿到老节点的真实元素
        const oldElm = oldVnode.elm;

        /**获取老节点的父元素，即 body */
        const parentElm = nodeOps.parentNode(oldElm);

        // create new node 基于新 vnode 创建整棵 DOM 树并插入到 body 元素下
        createElm(
          vnode,
          insertedVnodeQueue,
          // extremely rare edge case: do not insert if old element is in a
          // leaving transition. Only happens when combining transition +
          // keep-alive + HOCs. (#4590)
          oldElm._leaveCb ? null : parentElm,
          nodeOps.nextSibling(oldElm)
        );

        // update parent placeholder node element, recursively 递归更新父占位符节点元素
        if (isDef(vnode.parent)) {
          let ancestor = vnode.parent;
          const patchable = isPatchable(vnode);
          while (ancestor) {
            for (let i = 0; i < cbs.destroy.length; ++i) {
              cbs.destroy[i](ancestor);
            }
            ancestor.elm = vnode.elm;
            if (patchable) {
              for (let i = 0; i < cbs.create.length; ++i) {
                cbs.create[i](emptyNode, ancestor);
              }
              // #6513
              // invoke insert hooks that may have been merged by create hooks.
              // e.g. for directives that uses the "inserted" hook.
              const insert = ancestor.data.hook.insert;
              if (insert.merged) {
                // start at index 1 to avoid re-invoking component mounted hook
                for (let i = 1; i < insert.fns.length; i++) {
                  insert.fns[i]();
                }
              }
            } else {
              registerRef(ancestor);
            }
            ancestor = ancestor.parent;
          }
        }

        // destroy old node 移除老节点
        if (isDef(parentElm)) {
          removeVnodes([oldVnode], 0, 0);
        } else if (isDef(oldVnode.tag)) {
          invokeDestroyHook(oldVnode);
        }
      }
    }

    invokeInsertHook(vnode, insertedVnodeQueue, isInitialPatch);
    return vnode.elm;
  };
}
