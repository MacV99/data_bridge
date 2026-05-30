import { supabase, MEDIA_BUCKET } from './supabase.js';

// ─────────────────────────────────────────────────────────────
// Retry con backoff exponencial — maneja el cold-start de Supabase
// (plan free pausa el proyecto tras inactividad; el primer request
//  puede fallar o tardar mientras el proyecto despierta).
// ─────────────────────────────────────────────────────────────
const RETRY_DELAYS = [1000, 3000, 6000]; // ms entre reintentos

async function withRetry(runFn, label) {
  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    const { data, error } = await runFn();
    if (!error) return { data, error: null };

    lastError = error;
    if (attempt < RETRY_DELAYS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }

  console.error(`Error en ${label} (tras reintentos):`, lastError);
  return { data: null, error: lastError };
}

// ─────────────────────────────────────────────────────────────
// Storage — la media NUEVA se sube al bucket y se guarda la URL.
// Los base64 viejos (data:...) siguen funcionando tal cual.
// ─────────────────────────────────────────────────────────────

// ID único — crypto.randomUUID() solo existe en contexto seguro (HTTPS/localhost);
// si no, usa un fallback para no lanzar excepción.
function randomId() {
  return (
    crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

// Sube un data URL (base64) al bucket y devuelve la URL pública.
// Si el valor ya es una URL http(s) (media existente), lo devuelve sin tocar.
async function uploadDataUrl(value, folder) {
  if (!value || !value.startsWith('data:')) return value || null;

  const blob = await (await fetch(value)).blob();
  const mime = blob.type || 'application/octet-stream';
  const ext = mime.split('/')[1]?.split(';')[0] || 'bin';
  const path = `${folder}/${randomId()}.${ext}`;

  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, blob, { contentType: mime, upsert: false });

  if (error) {
    console.error('Error al subir a Storage:', error);
    return value; // fallback: guarda el base64 para no perder el dato
  }

  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Borra del bucket los archivos cuya URL apunte a campaign-media (best-effort).
async function deleteStorageFiles(urls) {
  const marker = `/${MEDIA_BUCKET}/`;
  const paths = urls
    .filter((u) => typeof u === 'string' && u.includes(marker))
    .map((u) => decodeURIComponent(u.split(marker)[1]?.split('?')[0]))
    .filter(Boolean);

  if (paths.length === 0) return;
  await supabase.storage.from(MEDIA_BUCKET).remove(paths);
}

// Construye las filas de duplas para insertar, subiendo las imágenes nuevas.
async function buildDuplaRows(campaignId, duplas) {
  return Promise.all(
    duplas.map(async (dupla, index) => ({
      campaign_id: campaignId,
      name: dupla.name,
      image_url: await uploadDataUrl(dupla.image, 'images'),
      text: dupla.text,
      dupla_order: index + 1,
    })),
  );
}

// Devuelve las URLs de media (audio + imágenes de duplas) de una campaña.
async function fetchCampaignMediaUrls(campaignId) {
  const { data } = await supabase
    .from('campaigns')
    .select('audio_url, duplas(image_url)')
    .eq('id', campaignId)
    .single();
  if (!data) return [];
  return [data.audio_url, ...(data.duplas || []).map((d) => d.image_url)];
}

// ─────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────

// Obtener campañas para el dashboard — SOLO campos de la card.
// No traemos duplas ni audio (base64 pesado) para que la query no se
// dispare en tamaño y haga statement timeout. El detalle se carga aparte.
export async function getCampaigns() {
  const { data, error } = await withRetry(
    () =>
      supabase
        .from('campaigns')
        .select('id, city_name, start_date, phone_number, status, created_at')
        .order('created_at', { ascending: false }),
    'getCampaigns',
  );

  if (error) return null;
  return data || [];
}

// Obtener una campaña completa (con duplas + audio) — para el modal de detalle/edición.
export async function getCampaignById(campaignId) {
  const { data, error } = await withRetry(
    () =>
      supabase
        .from('campaigns')
        .select('*, duplas(*)')
        .eq('id', campaignId)
        .single(),
    'getCampaignById',
  );

  if (error) return null;
  return data;
}

// Crear una nueva campaña con sus duplas
export async function createCampaign(campaignData) {
  // 1. Subir audio nuevo a Storage (si es base64)
  const audioUrl = await uploadDataUrl(campaignData.audioUrl, 'audio');

  // 2. Insertar la campaña
  const { data: campaign, error: campaignError } = await withRetry(
    () =>
      supabase
        .from('campaigns')
        .insert({
          city_name: campaignData.cityName,
          start_date: campaignData.startDate,
          phone_number: campaignData.phoneNumber,
          audio_url: audioUrl,
          status: 'pendiente',
        })
        .select()
        .single(),
    'createCampaign',
  );

  if (campaignError) return null;

  // 3. Subir imágenes nuevas e insertar las duplas
  const duplasToInsert = await buildDuplaRows(campaign.id, campaignData.duplas);

  const { error: duplasError } = await withRetry(
    () => supabase.from('duplas').insert(duplasToInsert),
    'createCampaign(duplas)',
  );

  if (duplasError) return null;

  return campaign;
}

// Actualizar una campaña existente
export async function updateCampaign(campaignId, campaignData) {
  // Media actual (para limpiar después) y subida del audio nuevo — en paralelo.
  const [oldUrls, audioUrl] = await Promise.all([
    fetchCampaignMediaUrls(campaignId),
    uploadDataUrl(campaignData.audioUrl, 'audio'),
  ]);

  // 1. Actualizar la campaña
  const { error: campaignError } = await withRetry(
    () =>
      supabase
        .from('campaigns')
        .update({
          city_name: campaignData.cityName,
          start_date: campaignData.startDate,
          phone_number: campaignData.phoneNumber,
          audio_url: audioUrl,
        })
        .eq('id', campaignId),
    'updateCampaign',
  );

  if (campaignError) return false;

  // 2. Eliminar duplas antiguas
  await withRetry(
    () => supabase.from('duplas').delete().eq('campaign_id', campaignId),
    'updateCampaign(deleteDuplas)',
  );

  // 3. Subir imágenes nuevas e insertar las duplas
  const duplasToInsert = await buildDuplaRows(campaignId, campaignData.duplas);

  const { error: duplasError } = await withRetry(
    () => supabase.from('duplas').insert(duplasToInsert),
    'updateCampaign(duplas)',
  );

  if (duplasError) return false;

  // Limpiar del Storage la media vieja que ya no se referencia.
  const newUrls = [audioUrl, ...duplasToInsert.map((d) => d.image_url)];
  await deleteStorageFiles(oldUrls.filter((u) => !newUrls.includes(u)));

  return true;
}

// Cambiar el estado de una campaña
export async function updateCampaignStatus(campaignId, newStatus) {
  const { error } = await withRetry(
    () =>
      supabase
        .from('campaigns')
        .update({ status: newStatus })
        .eq('id', campaignId),
    'updateCampaignStatus',
  );

  return !error;
}

// Eliminar una campaña (las duplas se eliminan automáticamente por CASCADE)
export async function deleteCampaign(campaignId) {
  // Best-effort: recolectar URLs de Storage para limpiarlas después.
  // Sin retry — si falla, simplemente no limpiamos (no debe demorar el borrado).
  const urls = await fetchCampaignMediaUrls(campaignId);

  const { error } = await withRetry(
    () => supabase.from('campaigns').delete().eq('id', campaignId),
    'deleteCampaign',
  );

  if (error) return false;

  await deleteStorageFiles(urls);
  return true;
}
