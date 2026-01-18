use napi_derive::napi;
use oxc_sourcemap::napi::SourceMap;

#[napi]
pub struct FakeJsPlugin {
    sourcemap: bool,
    cjs_default: bool,
    side_effects: bool,
}

#[napi]
impl FakeJsPlugin {
    #[napi(constructor)]
    pub fn new(sourcemap: bool, cjs_default: bool, side_effects: bool) -> Self {
        Self {
            sourcemap,
            cjs_default,
            side_effects,
        }
    }

    #[napi]
    pub fn transform(&self, code: String, id: String) -> TransformResult {
        TransformResult {
            code: "".to_owned(),
            map: None,
        }
    }

    #[napi]
    pub fn render_chunk(
        &self,
        code: String,
        file_name: String,
        module_ids: Vec<String>,
    ) -> TransformResult {
        TransformResult {
            code: "".to_owned(),
            map: None,
        }
    }
}

#[napi(object)]
pub struct TransformResult {
    pub code: String,
    pub map: Option<SourceMap>,
}
