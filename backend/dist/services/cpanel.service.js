import https from 'https';
import http from 'http';
export class CpanelService {
    config;
    constructor(config) {
        this.config = config || {
            host: process.env.CPANEL_HOST || 'cpanel.edunaiosh.com',
            username: process.env.CPANEL_USERNAME || 'edunaiosh',
            token: process.env.CPANEL_TOKEN || '',
            port: parseInt(process.env.CPANEL_PORT || '2083'),
            useSSL: process.env.CPANEL_USE_SSL !== 'false'
        };
    }
    /**
     * Make a request to cPanel API
     */
    async makeRequest(endpoint, params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const path = `/execute/${endpoint}${queryString ? '?' + queryString : ''}`;
        const options = {
            hostname: this.config.host,
            port: this.config.port,
            path,
            method: 'GET',
            headers: {
                'Authorization': `cpanel ${this.config.username}:${this.config.token}`
            },
            rejectUnauthorized: false // For self-signed certificates
        };
        return new Promise((resolve, reject) => {
            const client = this.config.useSSL ? https : http;
            const req = client.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.status === 1) {
                            resolve(parsed);
                        }
                        else if (parsed.errors && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
                            reject(new Error(parsed.errors[0]));
                        }
                        else {
                            reject(new Error('cPanel API request failed'));
                        }
                    }
                    catch (error) {
                        reject(new Error(`Failed to parse cPanel response: ${data}`));
                    }
                });
            });
            req.on('error', (error) => {
                reject(error);
            });
            req.end();
        });
    }
    /**
     * Create a subdomain in cPanel
     * @param subdomain - The subdomain name (without the main domain)
     * @param rootdomain - The main domain (e.g., edunaiosh.com)
     * @param dir - The directory path (optional, defaults to public_html/subdomain)
     */
    async createSubdomain(subdomain, rootdomain, dir) {
        const domain = rootdomain || process.env.MAIN_DOMAIN || 'betacdmy.com.vendoworld.com';
        const directory = dir || `public_html/${subdomain}`;
        try {
            const params = {
                domain: subdomain,
                rootdomain: domain,
                dir: directory
            };
            console.log(`Creating subdomain: ${subdomain}.${domain}`);
            const result = await this.makeRequest('SubDomain/addsubdomain', params);
            console.log(`Subdomain created successfully:`, result);
            return result;
        }
        catch (error) {
            console.error(`Failed to create subdomain ${subdomain}.${domain}:`, error);
            throw error;
        }
    }
    /**
     * Check if a subdomain exists in cPanel
     */
    async subdomainExists(subdomain, rootdomain) {
        const domain = rootdomain || process.env.MAIN_DOMAIN || 'betacdmy.com.vendoworld.com';
        try {
            const result = await this.makeRequest('DomainInfo/list_domains');
            const subdomains = result.data?.sub_domains || [];
            const fullSubdomain = `${subdomain}.${domain}`;
            return subdomains.includes(fullSubdomain);
        }
        catch (error) {
            console.error(`Failed to check subdomain existence:`, error);
            return false;
        }
    }
    /**
     * Delete a subdomain from cPanel
     */
    async deleteSubdomain(subdomain, rootdomain) {
        const domain = rootdomain || process.env.MAIN_DOMAIN || 'betacdmy.com.vendoworld.com';
        const fullSubdomain = `${subdomain}.${domain}`;
        try {
            const params = {
                domain: fullSubdomain
            };
            console.log(`Deleting subdomain: ${fullSubdomain}`);
            await this.makeRequest('SubDomain/delsubdomain', params);
            console.log(`Subdomain deleted successfully`);
        }
        catch (error) {
            console.error(`Failed to delete subdomain ${fullSubdomain}:`, error);
            throw error;
        }
    }
    /**
     * List all subdomains in cPanel
     */
    async listSubdomains() {
        try {
            const result = await this.makeRequest('DomainInfo/list_domains');
            return result.data?.sub_domains || [];
        }
        catch (error) {
            console.error('Failed to list subdomains:', error);
            return [];
        }
    }
}
