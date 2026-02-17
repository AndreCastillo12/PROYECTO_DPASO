import { supabase } from '../lib/supabaseClient'

export async function createOrder(payload) {
  const { data, error } = await supabase.rpc('create_order', { payload })
  if (error) throw error
  return data
}

export async function listMyOrders() {
  const { data, error } = await supabase.rpc('rpc_my_orders')
  if (error) throw error
  return data || []
}

export async function refreshCartAvailability(ids = []) {
  if (!ids.length) return []
  const { data, error } = await supabase
    .from('platos')
    .select('id,is_available,track_stock,stock,precio')
    .in('id', ids)
  if (error) throw error
  return data || []
}
