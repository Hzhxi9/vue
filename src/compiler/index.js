/* @flow */

import { parse } from "./parser/index";
import { optimize } from "./optimizer";
import { generate } from "./codegen/index";
import { createCompilerCreator } from "./create-compiler";

// `createCompilerCreator` allows creating compilers that use alternative
// parser/optimizer/codegen, e.g the SSR optimizing compiler.
// Here we just export a default compiler using the default parts.
export const createCompiler = createCompilerCreator(function baseCompile(
  template: string,
  options: CompilerOptions
): CompiledResult {
  /**执行baseCompiler 之前的所有事情， 只有一个目的，就是构造最终的配置选项 */

  /**核心*/
  /**解析， 将html模板字符串解析为ast对象 */
  const ast = parse(template.trim(), options);

  /**优化， 编译ast，标记静态节点和静态根节点 */
  if (options.optimize !== false) {
    optimize(ast, options);
  }

  /**代码生成，将ast转换为可执行render函数的字符串形式 */
  const code = generate(ast, options);
  return {
    ast,
    render: code.render,
    staticRenderFns: code.staticRenderFns,
  };
});
