//! WebAssembly bridge from cadmpeg (github.com/cadmpeg/cadmpeg, Apache-2.0) to Rodeo.
//!
//! Two builds, one per Cargo feature, both `wasm32-unknown-unknown` with `wasm-bindgen`:
//! `xt` reads a bare Parasolid transmit stream and tessellates it (`xt_mesh`, `xt_last_report`);
//! `native` converts any file the cadmpeg CLI reads to STEP in memory (`to_step`). Lengths are in
//! millimetres, cadmpeg's canonical unit. Nothing here touches files, threads or clocks.

use std::fmt::Display;

use wasm_bindgen::prelude::*;

fn js_error(message: impl Display) -> JsError {
    JsError::new(&message.to_string())
}

#[cfg(feature = "xt")]
mod xt {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use cadmpeg_ir::CadIr;
    use cadmpeg_tessellate::{Options, Tessellator};
    use js_sys::Float64Array;
    use serde_json::json;
    use wasm_bindgen::prelude::*;

    use super::js_error;

    /// Reasons kept in the report; the rest are counted and omitted.
    const MAX_REASONS: usize = 200;

    thread_local! {
        static LAST_REPORT: RefCell<String> = const { RefCell::new(String::new()) };
    }

    /// Tessellates every face of one bare Parasolid stream (`PS` signature first).
    ///
    /// `chord_rel` is the largest chordal deviation as a fraction of the model's bounding-box
    /// diagonal; `angle_deg` is the largest normal angle, in degrees, between neighbouring
    /// vertices of one triangle. `max_triangles` caps the work: a face stops refining at
    /// `max(64, max_triangles / (2 * faces in its body))` vertices, and the call fails as soon as
    /// the running total passes `max_triangles`. Returns the corners of every triangle as flat x,
    /// y, z numbers, nine per triangle, in millimetres. Faces the tessellator refuses are skipped
    /// and listed in `xt_last_report`. Fails when the stream does not decode, no face tessellates,
    /// or the total passes `max_triangles`.
    #[wasm_bindgen]
    pub fn xt_mesh(
        bytes: &[u8],
        chord_rel: f64,
        angle_deg: f64,
        max_triangles: u32,
    ) -> Result<Float64Array, JsError> {
        let mut report = Report::default();
        let outcome = mesh(bytes, chord_rel, angle_deg, max_triangles, &mut report);
        LAST_REPORT.with(|last| *last.borrow_mut() = report.to_json());
        let triangles = outcome.map_err(js_error)?;
        Ok(Float64Array::from(triangles.as_slice()))
    }

    /// The report of the previous `xt_mesh` call, as JSON:
    /// `{"faces", "tessellated", "refused", "triangles", "reasons"}`. `reasons` holds one
    /// `"face <id>: <reason>"` string per refused face, up to 200, then `"... N more"`.
    #[wasm_bindgen]
    pub fn xt_last_report() -> String {
        LAST_REPORT.with(|last| last.borrow().clone())
    }

    #[derive(Default)]
    struct Report {
        faces: usize,
        tessellated: usize,
        refused: usize,
        triangles: usize,
        reasons: Vec<String>,
        omitted: usize,
        error: Option<String>,
    }

    impl Report {
        fn to_json(&self) -> String {
            let mut reasons = self.reasons.clone();
            if self.omitted > 0 {
                reasons.push(format!("... {} more", self.omitted));
            }
            let mut value = json!({
                "faces": self.faces,
                "tessellated": self.tessellated,
                "refused": self.refused,
                "triangles": self.triangles,
                "reasons": reasons,
            });
            if let Some(error) = &self.error {
                value["error"] = json!(error);
            }
            value.to_string()
        }
    }

    fn mesh(
        bytes: &[u8],
        chord_rel: f64,
        angle_deg: f64,
        max_triangles: u32,
        report: &mut Report,
    ) -> Result<Vec<f64>, String> {
        let result = mesh_inner(bytes, chord_rel, angle_deg, max_triangles, report);
        if let Err(error) = &result {
            report.error = Some(error.clone());
        }
        result
    }

    fn mesh_inner(
        bytes: &[u8],
        chord_rel: f64,
        angle_deg: f64,
        max_triangles: u32,
        report: &mut Report,
    ) -> Result<Vec<f64>, String> {
        if !(chord_rel.is_finite() && chord_rel > 0.0) {
            return Err("chord_rel must be a positive number".into());
        }
        if !(angle_deg.is_finite() && angle_deg > 0.0 && angle_deg < 180.0) {
            return Err("angle_deg must be between 0 and 180".into());
        }
        if max_triangles == 0 {
            return Err("max_triangles must be at least 1".into());
        }
        let max_triangles = max_triangles as usize;
        let ir = cadmpeg_codec_sldprt::bare_parasolid::transfer_bare_parasolid(bytes)
            .map_err(|error| format!("transfer: {error}"))?;
        report.faces = ir.model.faces.len();
        if ir.model.faces.is_empty() {
            return Err("the stream decodes to no faces".into());
        }
        let diagonal = bounding_diagonal(&ir)
            .ok_or_else(|| "the model has no extent to measure the chord against".to_owned())?;
        let options = Options {
            chord: chord_rel * diagonal,
            angle: angle_deg.to_radians(),
            ..Options::default()
        };
        let mut tessellator = Tessellator::new(&ir, options);
        let mut corners = Vec::new();
        for group in face_groups(&ir) {
            // Each face of a body with n faces may take 1/(2n) of the cap, so a body meshes to
            // about max_triangles at most, however many faces it has.
            tessellator.set_options(Options {
                max_vertices: (max_triangles / (2 * group.len())).max(64),
                ..options
            });
            for index in group {
                let face = &ir.model.faces[index];
                match tessellator.face(&face.id) {
                    Ok(mesh) => {
                        report.tessellated += 1;
                        for triangle in &mesh.triangles {
                            for &corner in triangle {
                                let point = &mesh.positions[corner];
                                corners.extend_from_slice(&[point.x, point.y, point.z]);
                            }
                        }
                        if corners.len() / 9 > max_triangles {
                            report.triangles = corners.len() / 9;
                            return Err(format!("more than {max_triangles} triangles"));
                        }
                    }
                    Err(refusal) => {
                        report.refused += 1;
                        if report.reasons.len() < MAX_REASONS {
                            report
                                .reasons
                                .push(format!("face {}: {}", face.id, refusal.reason()));
                        } else {
                            report.omitted += 1;
                        }
                    }
                }
            }
        }
        report.triangles = corners.len() / 9;
        if corners.is_empty() {
            return Err(format!("no face of {} tessellated", report.faces));
        }
        Ok(corners)
    }

    /// Indices into `ir.model.faces`, one group per body in model order, each face once. Faces no
    /// body reaches form a last group. Empty groups are left out.
    fn face_groups(ir: &CadIr) -> Vec<Vec<usize>> {
        let face_index: HashMap<_, _> = ir
            .model
            .faces
            .iter()
            .enumerate()
            .map(|(index, face)| (&face.id, index))
            .collect();
        let regions: HashMap<_, _> = ir
            .model
            .regions
            .iter()
            .map(|region| (&region.id, region))
            .collect();
        let shells: HashMap<_, _> = ir
            .model
            .shells
            .iter()
            .map(|shell| (&shell.id, shell))
            .collect();
        let mut claimed = vec![false; ir.model.faces.len()];
        let mut groups = Vec::new();
        for body in &ir.model.bodies {
            let mut group = Vec::new();
            for region_id in &body.regions {
                let Some(region) = regions.get(region_id) else {
                    continue;
                };
                for shell_id in &region.shells {
                    let Some(shell) = shells.get(shell_id) else {
                        continue;
                    };
                    for face_id in shell.faces() {
                        if let Some(&index) = face_index.get(face_id) {
                            if !claimed[index] {
                                claimed[index] = true;
                                group.push(index);
                            }
                        }
                    }
                }
            }
            if !group.is_empty() {
                groups.push(group);
            }
        }
        let rest: Vec<usize> = (0..claimed.len()).filter(|&index| !claimed[index]).collect();
        if !rest.is_empty() {
            groups.push(rest);
        }
        groups
    }

    /// The diagonal of the box around every model point, or `None` when it has no extent.
    fn bounding_diagonal(ir: &CadIr) -> Option<f64> {
        let mut low = [f64::INFINITY; 3];
        let mut high = [f64::NEG_INFINITY; 3];
        for vertex_point in &ir.model.points {
            let position = vertex_point.position();
            let point = position.as_raw();
            for (axis, value) in [point.x, point.y, point.z].into_iter().enumerate() {
                low[axis] = low[axis].min(value);
                high[axis] = high[axis].max(value);
            }
        }
        let squares: f64 = (0..3).map(|axis| (high[axis] - low[axis]).powi(2)).sum();
        let diagonal = squares.sqrt();
        (diagonal.is_finite() && diagonal > 0.0).then_some(diagonal)
    }
}

#[cfg(feature = "native")]
mod native {
    use std::io::Cursor;

    use cadmpeg_container::compound::read_detection_prefix;
    use cadmpeg_core::decode::{u64_from_index, DecodeArena, DecodeContext, DecodePolicy, View};
    use cadmpeg_ir::codec::write::{target::TargetRequest, EncodeInput};
    use cadmpeg_ir::report::Severity;
    use cadmpeg_ir::Codec;
    use cadmpeg_measure::WorkProfile;
    use cadmpeg_registry::{
        build_encoder, check_with_context, headline_level, Format, InputCatalog, ResolvedSource,
        DETECTION_PREFIX_LEN,
    };
    use serde_json::json;
    use wasm_bindgen::prelude::*;

    use super::js_error;

    /// A converted document: the STEP bytes and what the conversion reported.
    #[wasm_bindgen]
    pub struct Converted {
        step: Vec<u8>,
        format: String,
        level: u8,
        warnings: String,
    }

    #[wasm_bindgen]
    impl Converted {
        /// The STEP file, as written.
        #[wasm_bindgen(getter)]
        pub fn step(&self) -> Vec<u8> {
            self.step.clone()
        }

        /// cadmpeg's id of the format that was read, such as `sldprt`.
        #[wasm_bindgen(getter)]
        pub fn format(&self) -> String {
            self.format.clone()
        }

        /// The headline read level of the format in cadmpeg's support ladder (`L<level>`), or 0.
        #[wasm_bindgen(getter)]
        pub fn level(&self) -> u8 {
            self.level
        }

        /// A JSON array of strings: decode losses (`decode: ...`), check findings of warning
        /// severity or more (`check: ...`), error findings carried into the output, and export
        /// losses (`export: ...`).
        #[wasm_bindgen(getter)]
        pub fn warnings(&self) -> String {
            self.warnings.clone()
        }
    }

    /// Converts a CAD file to STEP in memory, as `cadmpeg convert <file> -f step --allow-errors`
    /// does: the format is detected from the bytes, the decode runs at the depth STEP needs, the
    /// check runs, and the file is written whatever the check finds. `file_name` appears only in
    /// error messages, since detection reads the bytes and never the name.
    #[wasm_bindgen]
    pub fn to_step(bytes: &[u8], file_name: &str) -> Result<Converted, JsError> {
        convert(bytes, file_name).map_err(js_error)
    }

    fn convert(bytes: &[u8], file_name: &str) -> Result<Converted, String> {
        let inputs = InputCatalog::with_builtins();
        let encoder = build_encoder(Format::Step);
        let policy = DecodePolicy::desktop();
        let depth = encoder.needs().request();

        let arena = DecodeArena::new();
        let ctx = DecodeContext::new(&arena, &policy, depth);
        let mut source = Cursor::new(bytes);
        let mut prefix = read_detection_prefix(&ctx, &mut source, DETECTION_PREFIX_LEN)
            .map_err(|error| format!("{file_name}: {error}"))?;
        let codec: &dyn Codec = match inputs
            .resolve_seekable_source(&ctx, View::over_retained(&prefix), &mut source, None)
            .map_err(|error| format!("{file_name}: {error}"))?
        {
            ResolvedSource::Native { codec, .. } => codec,
            ResolvedSource::Cadir => {
                return Err(format!("{file_name} is CADIR JSON, not a native CAD file"))
            }
            ResolvedSource::Unrecognized => {
                return Err(format!("unrecognized CAD format for {file_name}"))
            }
        };
        let format = codec.id();
        ctx.complete_input(&mut source, &mut prefix)
            .map_err(|error| format!("{file_name}: {error}"))?;
        let decoded = codec.decode_with_context(&ctx, View::over_retained(&prefix));
        ctx.finish_session()
            .map_err(|error| format!("{file_name}: {error}"))?;
        let input_bytes = u64_from_index(prefix.len());
        let result = decoded.map_err(|failure| format!("{file_name}: {failure}"))?;
        let (ir, decode_report, fidelity) = result.into_parts();

        let check_arena = DecodeArena::new();
        let check_ctx = DecodeContext::for_loaded_input(&check_arena, &policy, input_bytes)
            .map_err(|error| format!("{file_name}: {error}"))?;
        let validation = check_with_context(
            &check_ctx,
            &inputs,
            &ir,
            Some(&fidelity),
            decode_report.losses.clone(),
            WorkProfile::Desktop,
        )
        .map_err(|error| format!("{file_name}: {error}"))?;
        check_ctx
            .finish_session()
            .map_err(|error| format!("{file_name}: {error}"))?;

        let plan = encoder
            .plan(
                EncodeInput::new(&ir, Some(&fidelity)),
                TargetRequest::Inherit,
            )
            .map_err(|error| format!("{file_name}: {error}"))?;
        let carried = plan.carried_errors(&ir, &validation).len();
        let mut step = Vec::new();
        let export = plan
            .write_to(&mut step)
            .map_err(|error| format!("{file_name}: {error}"))?;

        let mut warnings: Vec<String> = decode_report
            .losses
            .iter()
            .map(|loss| format!("decode: {}", loss.message))
            .collect();
        warnings.extend(
            validation
                .findings
                .iter()
                .filter(|finding| finding.severity >= Severity::Warning)
                .map(|finding| format!("check: {}", finding.message)),
        );
        if carried > 0 {
            warnings.push(format!(
                "check: {carried} error finding(s) carried into the {} output",
                encoder.id()
            ));
        }
        warnings.extend(
            export
                .losses
                .iter()
                .map(|loss| format!("export: {}", loss.message)),
        );
        let level = headline_level(format.as_str())
            .ok()
            .flatten()
            .unwrap_or(0);
        Ok(Converted {
            step,
            format: format.as_str().to_owned(),
            level,
            warnings: json!(warnings).to_string(),
        })
    }
}
