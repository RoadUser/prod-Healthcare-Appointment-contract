function ok(success, events) {
  return { success: success || null, events: events || [] };
}

function fail(error) {
  return { error };
}

module.exports = { ok, fail };
