import { supabase } from './supabase.js';

// Obtener todas las campañas
export async function getCampaigns() {
  const { data, error } = await supabase
    .from('campaigns')
    .select(`
      *,
      duplas (*)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error al obtener campañas:', error);
    return [];
  }

  return data || [];
}

// Crear una nueva campaña con sus duplas
export async function createCampaign(campaignData) {
  // 1. Insertar la campaña
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .insert({
      city_name: campaignData.cityName,
      start_date: campaignData.startDate,
      phone_number: campaignData.phoneNumber,
      status: 'pendiente'
    })
    .select()
    .single();

  if (campaignError) {
    console.error('Error al crear campaña:', campaignError);
    return null;
  }

  // 2. Insertar las duplas
  const duplasToInsert = campaignData.duplas.map((dupla, index) => ({
    campaign_id: campaign.id,
    name: dupla.name,
    image_url: dupla.image,
    text: dupla.text,
    dupla_order: index + 1
  }));

  const { error: duplasError } = await supabase
    .from('duplas')
    .insert(duplasToInsert);

  if (duplasError) {
    console.error('Error al crear duplas:', duplasError);
    return null;
  }

  return campaign;
}

// Actualizar una campaña existente
export async function updateCampaign(campaignId, campaignData) {
  // 1. Actualizar la campaña
  const { error: campaignError } = await supabase
    .from('campaigns')
    .update({
      city_name: campaignData.cityName,
      start_date: campaignData.startDate,
      phone_number: campaignData.phoneNumber
    })
    .eq('id', campaignId);

  if (campaignError) {
    console.error('Error al actualizar campaña:', campaignError);
    return false;
  }

  // 2. Eliminar duplas antiguas
  await supabase
    .from('duplas')
    .delete()
    .eq('campaign_id', campaignId);

  // 3. Insertar nuevas duplas
  const duplasToInsert = campaignData.duplas.map((dupla, index) => ({
    campaign_id: campaignId,
    name: dupla.name,
    image_url: dupla.image,
    text: dupla.text,
    dupla_order: index + 1
  }));

  const { error: duplasError } = await supabase
    .from('duplas')
    .insert(duplasToInsert);

  if (duplasError) {
    console.error('Error al actualizar duplas:', duplasError);
    return false;
  }

  return true;
}

// Cambiar el estado de una campaña
export async function updateCampaignStatus(campaignId, newStatus) {
  const { error } = await supabase
    .from('campaigns')
    .update({ status: newStatus })
    .eq('id', campaignId);

  if (error) {
    console.error('Error al cambiar estado:', error);
    return false;
  }

  return true;
}

// Eliminar una campaña (las duplas se eliminan automáticamente por CASCADE)
export async function deleteCampaign(campaignId) {
  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', campaignId);

  if (error) {
    console.error('Error al eliminar campaña:', error);
    return false;
  }

  return true;
}