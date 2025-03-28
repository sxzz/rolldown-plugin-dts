// index.d.ts

//#region tests/fixtures/ts43-override/foo.d.ts
interface ShowT {}
interface HideT {}
declare class SomeComponent {
  show(): ShowT;
  hide(): HideT;
}

//#endregion
//#region tests/fixtures/ts43-override/index.d.ts
declare class SpecializedComponent extends SomeComponent {
  override show(): ShowT;
  override hide(): HideT;
}

//#endregion
export { SpecializedComponent };