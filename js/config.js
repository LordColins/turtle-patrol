// Turtle Patrol settings. This is the only file that changes between projects.
export const CONFIG = {
  // From Supabase → Project Settings. The publishable key is safe to publish:
  // the database rules decide what each person can see and change.
  supabaseUrl: 'https://vzqroytekzqafcpeajlt.supabase.co',
  supabaseKey: 'sb_publishable_JTrxsJSId4yoKKW1dm0lgQ_axvEmNPR',

  // Free key from developers.arcgis.com for the satellite map.
  // Leave empty while testing; Esri asks sites to use a key before launch.
  esriKey: '',

  appName: 'Turtle Patrol',

  // Where the map opens before any sector borders are drawn.
  regionCenters: {
    FAM: { lat: 35.155, lng: 33.915, zoom: 13 },
    ISK: { lat: 35.285, lng: 33.925, zoom: 13 },
    BAF: { lat: 35.335, lng: 34.05, zoom: 13 },
  },
};
