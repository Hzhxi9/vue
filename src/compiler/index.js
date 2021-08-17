/* @flow */

import { parse } from "./parser/index";
import { optimize } from "./optimizer";
import { generate } from "./codegen/index";
import { createCompilerCreator } from "./create-compiler";

// `createCompilerCreator` allows creating compilers that use alternative
// parser/optimizer/codegen, e.g the SSR optimizing compiler.
// Here we just export a default compiler using the default parts.

/**
 * `createCompilerCreator`允许创建使用替代方法的编译
 * 解析器/优化器/代码生成器，例如SSR优化编译器。
 * 这里我们只是使用默认部分导出默认编译器。
 */

/**
 *  在这之前做的所有事都是为了构建平台特有的编译选项(options),比如web平台
 */
export const createCompiler = createCompilerCreator(
  /**
   * 1. 将html模板解析成ast
   * 2. 对ast数进行静态标记
   * 3. 将ast生成渲染函数
   *
   * 静态渲染函数放到code.staticRenderFns数组中
   * code.render为动态渲染函数
   * 在将来渲染时执行渲染函数得到VNode
   *
   * @param {*} template 模板字符串
   * @param {*} options 配置项
   * @returns
   */
  function baseCompile(
    template: string,
    options: CompilerOptions
  ): CompiledResult {
    /**执行baseCompiler 之前的所有事情， 只有一个目的，就是构造最终的配置选项 */

    /**核心*/
    /**
     * 解析， 将html模板字符串解析为ast对象
     * 将模板解析成AST, 每个节点的ast对象上设置了元素的所有信息，比如标签信息，属性信息， 插槽信息，父节点，子节点
     * 具有有那些属性，查看start和end这两个处理开始和结束标签的方法
     **/
    const ast = parse(template.trim(), options);

    /**
     * 优化， 遍历ast，标记静态节点和静态根节点
     *
     * 标记每个节点是否为静态节点，然后进一步标记静态根节点
     * 这样在后续更新中就可以跳过这些静态节点
     * 标记静态根节点，用于生成渲染函数阶段，生成静态根节点的渲染函数
     **/
    if (options.optimize !== false) {
      optimize(ast, options);
    }

    /**
     * 代码生成，将ast转换为可执行render函数的字符串形式
     * 从ast生成渲染函数，生成比如code.render = "_c('div',{attrs:{"id":"app"}},_l((arr),function(item){return _c('div',{key:item},[_v(_s(item))])}),0)"
     */
    const code = generate(ast, options);

    return {
      ast,
      render: code.render,
      staticRenderFns: code.staticRenderFns,
    };
  }
);
