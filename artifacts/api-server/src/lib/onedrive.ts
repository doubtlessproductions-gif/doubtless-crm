// Microsoft OneDrive integration via user OAuth tokens stored in the DB
// Calls Microsoft Graph API directly — no Replit connector dependency.
import { getStoredMicrosoftToken, ONEDRIVE_SCOPES } from "./microsoft-graph.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SELECT = "$select=id,name,size,lastModifiedDateTime,webUrl,file,folder,remoteItem,@microsoft.graph.downloadUrl";
const SITE_SELECT = "$select=id,name,displayName,webUrl,description";

export interface DriveItem {
  id: string;
  name: string;
  size: number;
  lastModifiedDateTime: string;
  webUrl: string;
  file?: { mimeType: string };
  folder?: { childCount: number };
  "@microsoft.graph.downloadUrl"?: string;
  remoteItem?: {
    id: string;
    parentReference: { driveId: string; driveType?: string };
    folder?: { childCount: number };
    file?: { mimeType: string };
    size?: number;
    lastModifiedDateTime?: string;
    webUrl?: string;
  };
}

export interface SiteItem {
  id: string;
  name: string;
  displayName: string;
  webUrl: string;
  description?: string;
}

async function graphGet(userId: number, path: string): Promise<Response> {
  const token = await getStoredMicrosoftToken(userId, "onedrive", ONEDRIVE_SCOPES);
  if (!token) throw Object.assign(new Error("not_connected"), { notConnected: true });
  return fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

async function graphRequest(
  userId: number,
  path: string,
  method: string,
  body?: unknown,
  contentType?: string,
): Promise<Response> {
  const token = await getStoredMicrosoftToken(userId, "onedrive", ONEDRIVE_SCOPES);
  if (!token) throw Object.assign(new Error("not_connected"), { notConnected: true });
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined && contentType) headers["Content-Type"] = contentType;
  return fetch(`${GRAPH}${path}`, {
    method,
    headers,
    body: body instanceof Buffer ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function isOneDriveConnected(userId: number): Promise<boolean> {
  try {
    const r = await graphGet(userId, "/me/drive");
    return r.ok;
  } catch {
    return false;
  }
}

export async function listRootFiles(userId: number): Promise<DriveItem[]> {
  const r = await graphGet(userId, `/me/drive/root/children?${SELECT}`);
  if (!r.ok) return [];
  const data = (await r.json()) as { value?: DriveItem[] };
  return data.value ?? [];
}

export async function listFolderFiles(userId: number, folderId: string): Promise<DriveItem[]> {
  const r = await graphGet(userId, `/me/drive/items/${folderId}/children?${SELECT}`);
  if (!r.ok) return [];
  const data = (await r.json()) as { value?: DriveItem[] };
  return data.value ?? [];
}

export async function listRemoteFolderFiles(userId: number, driveId: string, itemId: string): Promise<DriveItem[]> {
  const r = await graphGet(userId, `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children?${SELECT}`);
  if (!r.ok) return [];
  const data = (await r.json()) as { value?: DriveItem[] };
  return data.value ?? [];
}

export async function searchFiles(userId: number, query: string): Promise<DriveItem[]> {
  const r = await graphGet(userId, `/me/drive/root/search(q='${encodeURIComponent(query)}')?${SELECT}`);
  if (!r.ok) return [];
  const data = (await r.json()) as { value?: DriveItem[] };
  return data.value ?? [];
}

export async function listSharedWithMe(userId: number): Promise<DriveItem[]> {
  const r = await graphGet(userId, `/me/drive/sharedWithMe?${SELECT}`);
  if (!r.ok) return [];
  const data = (await r.json()) as { value?: DriveItem[] };
  return data.value ?? [];
}

export async function listRecentFiles(userId: number): Promise<DriveItem[]> {
  const r = await graphGet(userId, `/me/drive/recent?${SELECT}&$top=25`);
  if (!r.ok) return [];
  const data = (await r.json()) as { value?: DriveItem[] };
  return data.value ?? [];
}

export async function listFollowedSites(userId: number): Promise<SiteItem[]> {
  const r = await graphGet(userId, `/me/followedSites?${SITE_SELECT}`);
  if (!r.ok) {
    const fallback = await graphGet(userId, `/sites?search=*&${SITE_SELECT}&$top=50`);
    if (!fallback.ok) return [];
    const data = (await fallback.json()) as { value?: SiteItem[] };
    return data.value ?? [];
  }
  const data = (await r.json()) as { value?: SiteItem[] };
  return data.value ?? [];
}

export async function listSiteRootFiles(userId: number, siteId: string): Promise<DriveItem[]> {
  const r = await graphGet(userId, `/sites/${encodeURIComponent(siteId)}/drive/root/children?${SELECT}`);
  if (!r.ok) return [];
  const data = (await r.json()) as { value?: DriveItem[] };
  return data.value ?? [];
}

export async function listSiteFolderFiles(userId: number, driveId: string, itemId: string): Promise<DriveItem[]> {
  return listRemoteFolderFiles(userId, driveId, itemId);
}

export async function getSiteDriveId(userId: number, siteId: string): Promise<string | null> {
  const r = await graphGet(userId, `/sites/${encodeURIComponent(siteId)}/drive?$select=id`);
  if (!r.ok) return null;
  const data = (await r.json()) as { id?: string };
  return data.id ?? null;
}

/** Upload a file (≤4 MB simple upload) to the user's OneDrive. */
export async function uploadFile(
  userId: number,
  parentFolderId: string | null,
  fileName: string,
  buffer: Buffer,
  mimeType: string,
): Promise<DriveItem | null> {
  const parent = parentFolderId ? `items/${parentFolderId}` : "root";
  const r = await graphRequest(
    userId,
    `/me/drive/${parent}:/${encodeURIComponent(fileName)}:/content`,
    "PUT",
    buffer,
    mimeType,
  );
  if (!r.ok) return null;
  return r.json() as Promise<DriveItem>;
}

/** Create a new folder inside the user's OneDrive. */
export async function createFolder(
  userId: number,
  parentFolderId: string | null,
  name: string,
): Promise<DriveItem | null> {
  const parent = parentFolderId ? `items/${parentFolderId}` : "root";
  const r = await graphRequest(
    userId,
    `/me/drive/${parent}/children`,
    "POST",
    { name, folder: {}, "@microsoft.graph.conflictBehavior": "rename" },
    "application/json",
  );
  if (!r.ok) return null;
  return r.json() as Promise<DriveItem>;
}

/** Delete a file or folder. Uses the user's personal drive (my drive). */
export async function deleteItem(userId: number, itemId: string): Promise<boolean> {
  const r = await graphRequest(userId, `/me/drive/items/${encodeURIComponent(itemId)}`, "DELETE");
  return r.status === 204;
}

/** Rename a file or folder. */
export async function renameItem(userId: number, itemId: string, newName: string): Promise<DriveItem | null> {
  const r = await graphRequest(
    userId,
    `/me/drive/items/${encodeURIComponent(itemId)}`,
    "PATCH",
    { name: newName },
    "application/json",
  );
  if (!r.ok) return null;
  return r.json() as Promise<DriveItem>;
}

/** Get a short-lived download URL for a file. */
export async function getDownloadUrl(userId: number, itemId: string): Promise<string | null> {
  const r = await graphGet(userId, `/me/drive/items/${encodeURIComponent(itemId)}?$select=id,@microsoft.graph.downloadUrl`);
  if (!r.ok) return null;
  const data = (await r.json()) as { "@microsoft.graph.downloadUrl"?: string };
  return data["@microsoft.graph.downloadUrl"] ?? null;
}
