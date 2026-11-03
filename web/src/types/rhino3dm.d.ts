// rhino3dm's ES module build, which its package.json doesn't name: the same factory as the main entry.
declare module "rhino3dm/rhino3dm.module.js" {
  import rhino3dm from "rhino3dm";
  export default rhino3dm;
}
