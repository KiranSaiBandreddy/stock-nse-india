import puppeteer from 'puppeteer-extra'
import { Browser, Page, Cookie } from 'puppeteer'
import stealthPlugin from 'puppeteer-extra-plugin-stealth'
import chromium from '@sparticuz/chromium'
import UserAgent from 'user-agents'
import { getDateRangeChunks } from './utils'
import {
    DateRange,
    IntradayData,
    EquityDetails,
    EquityTradeInfo,
    EquityHistoricalData,
    SeriesData,
    IndexDetails,
    IndexHistoricalData,
    OptionChainData,
    EquityCorporateInfo,
    Glossary,
    Holiday,
    MarketStatus,
    MarketTurnover,
    IndexName,
    Circular,
    EquityMaster,
    PreOpenMarketData,
    DailyReport
} from './interface'

export enum ApiList {
    GLOSSARY = '/api/cmsContent?url=/glossary',
    HOLIDAY_TRADING = '/api/holiday-master?type=trading',
    HOLIDAY_CLEARING = '/api/holiday-master?type=clearing',
    MARKET_STATUS = '/api/marketStatus',
    MARKET_TURNOVER = '/api/market-turnover',
    ALL_INDICES = '/api/allIndices',
    INDEX_NAMES = '/api/index-names',
    CIRCULARS = '/api/circulars',
    LATEST_CIRCULARS = '/api/latest-circular',
    EQUITY_MASTER = '/api/equity-master',
    MARKET_DATA_PRE_OPEN = '/api/market-data-pre-open?key=ALL',
    MERGED_DAILY_REPORTS_CAPITAL = '/api/merged-daily-reports?key=favCapital',
    MERGED_DAILY_REPORTS_DERIVATIVES = '/api/merged-daily-reports?key=favDerivatives',
    MERGED_DAILY_REPORTS_DEBT = '/api/merged-daily-reports?key=favDebt',
    LIVE_ANALYSIS_VOLUME_GAINERS = '/api/live-analysis-volume-gainers'
}

export class NseIndia {
    private readonly baseUrl = 'https://www.nseindia.com'
    private readonly cookieMaxAge = 60 // should be in seconds
    private readonly baseHeaders = {
        'Authority': 'www.nseindia.com',
        'Referer': 'https://www.nseindia.com/',
        'Accept': '*/*',
        'Origin': this.baseUrl,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'application/json, text/plain, */*',
        'Connection': 'keep-alive'
    }
    private userAgent = ''
    private cookies = ''
    private cookieUsedCount = 0
    private cookieExpiry = new Date().getTime() + (this.cookieMaxAge * 1000)
    private browser: Browser | null = null;
    private page: Page | null = null;
    private async getNseCookies() {
        if (this.cookies === '' || this.cookieUsedCount > 10 || this.cookieExpiry <= new Date().getTime()) {
            this.userAgent = new UserAgent().toString()
            puppeteer.use(stealthPlugin());
            if (this.browser && this.browser.isConnected()) {
                this.page = await this.browser.newPage();
            } else {
                const browserWSEndpoint = process.env.BROWSER_WS_ENDPOINT;
                if (browserWSEndpoint) {
                    this.browser = await puppeteer.connect({ browserWSEndpoint });
                } else {
                    this.browser = await puppeteer.launch({
                        args: chromium.args,
                        defaultViewport: chromium.defaultViewport,
                        executablePath: await chromium.executablePath(),
                        headless: chromium.headless
                    });
                }
                this.page = await this.browser.newPage();
            }
            await this.page.setUserAgent(this.userAgent);
            await this.page.goto(`${this.baseUrl}/get-quotes/equity?symbol=TCS`, { waitUntil: 'networkidle2' });
            const cookies = await this.page.cookies();
            this.cookies = cookies.map((cookie: Cookie) => `${cookie.name}=${cookie.value}`).join('; ');
            this.cookieUsedCount = 0
            this.cookieExpiry = new Date().getTime() + (this.cookieMaxAge * 1000)
        }
        this.cookieUsedCount++
        return this.cookies
    }
    /**
     * 
     * @param url NSE API's URL
     * @returns JSON data from NSE India
     */
    async getData<T>(url: string): Promise<T> {
        let retries = 0
        let hasError = false
        do {
            try {
                if (!this.page || this.page.isClosed()) {
                    await this.getNseCookies();
                }
                const response = await this.page!.evaluate(async (url: string, headers: Record<string, string>) => {
                    const response = await fetch(url, { headers });
                    return response.json();
                }, url, {
                    ...this.baseHeaders,
                    'Cookie': await this.getNseCookies(),
                    'User-Agent': this.userAgent
                });
                return response as T;
            } catch (error) {
                hasError = true
                retries++
                if (this.page) {
                    await this.page.close();
                    this.page = null;
                }
                if (this.browser && !this.browser.isConnected()) {
                    await this.browser.close();
                    this.browser = null;
                }
                if (retries >= 10)
                    throw error
            }
        } while (hasError);
        return {} as T
    }
    /**
     * 
     * @param apiEndpoint 
     * @returns 
     */
    async getDataByEndpoint<T>(apiEndpoint: string): Promise<T> {
        return this.getData<T>(`${this.baseUrl}${apiEndpoint}`)
    }
    /**
     * 
     * @returns List of NSE equity symbols
     */
    async getAllStockSymbols(): Promise<string[]> {
        const { data } = await this.getDataByEndpoint<{ data: { metadata: { symbol: string } }[] }>(
            ApiList.MARKET_DATA_PRE_OPEN
        )
        return data.map((obj: { metadata: { symbol: string } }) => obj.metadata.symbol).sort()
    }
    /**
     * 
     * @param symbol 
     * @returns 
     */
    getEquityDetails(symbol: string): Promise<EquityDetails> {
        const url = `/api/quote-equity?symbol=${encodeURIComponent(symbol.toUpperCase())}`
        return this.getDataByEndpoint<EquityDetails>(url)
    }
    /**
     * 
     * @param symbol 
     * @returns 
     */
    getEquityTradeInfo(symbol: string): Promise<EquityTradeInfo> {
        return this.getDataByEndpoint<EquityTradeInfo>(`/api/quote-equity?symbol=${encodeURIComponent(symbol
            .toUpperCase())}&section=trade_info`)
    }

    /**
     * 
     * @param symbol 
     * @returns 
     */
    getEquityCorporateInfo(symbol: string): Promise<EquityCorporateInfo> {
        return this.getDataByEndpoint<EquityCorporateInfo>(`/api/top-corp-info?symbol=${encodeURIComponent(symbol
            .toUpperCase())}&market=equities`)
    }
    /**
     * 
     * @param symbol 
     * @param isPreOpenData 
     * @returns 
     */
    async getEquityIntradayData(symbol: string, isPreOpenData = false): Promise<IntradayData> {
        const details = await this.getEquityDetails(symbol.toUpperCase())
        const identifier = details.info.identifier
        let url = `/api/chart-databyindex?index=${identifier}`
        if (isPreOpenData)
            url += '&preopen=true'
        return this.getDataByEndpoint<IntradayData>(url)
    }
    /**
     * 
     * @param symbol 
     * @param range 
     * @returns 
     */
    async getEquityHistoricalData(symbol: string, range?: DateRange): Promise<EquityHistoricalData[]> {
        const data = await this.getEquityDetails(symbol.toUpperCase())
        const activeSeries = data.info.activeSeries.length ? data.info.activeSeries[0] : /* istanbul ignore next */ 'EQ'
        if (!range) {
            range = { start: new Date(data.metadata.listingDate), end: new Date() }
        }
        const dateRanges = getDateRangeChunks(range.start, range.end, 66)
        const promises = dateRanges.map(async (dateRange) => {
            const url = `/api/historical/cm/equity?symbol=${encodeURIComponent(symbol.toUpperCase())}` +
                `&series=[%22${activeSeries}%22]&from=${dateRange.start}&to=${dateRange.end}`
            return this.getDataByEndpoint<EquityHistoricalData>(url)
        })
        return Promise.all(promises)
    }
    /**
     * 
     * @param symbol 
     * @returns 
     */
    getEquitySeries(symbol: string): Promise<SeriesData> {
        return this.getDataByEndpoint<SeriesData>(`/api/historical/cm/equity/series?symbol=${encodeURIComponent(symbol
            .toUpperCase())}`)
    }
    /**
     * 
     * @param index 
     * @returns 
     */
    getEquityStockIndices(index: string): Promise<IndexDetails> {
        const url = `/api/equity-stockIndices?index=${encodeURIComponent(index.toUpperCase())}`
        return this.getDataByEndpoint<IndexDetails>(url)
    }
    /**
     * 
     * @param index 
     * @param isPreOpenData 
     * @returns 
     */
    getIndexIntradayData(index: string, isPreOpenData = false): Promise<IntradayData> {
        let endpoint = `/api/chart-databyindex?index=${index.toUpperCase()}&indices=true`
        if (isPreOpenData)
            endpoint += '&preopen=true'
        return this.getDataByEndpoint<IntradayData>(endpoint)
    }
    /**
     * 
     * @param index 
     * @param range 
     * @returns 
     */
    async getIndexHistoricalData(index: string, range: DateRange): Promise<IndexHistoricalData[]> {
        const dateRanges = getDateRangeChunks(range.start, range.end, 66)
        const promises = dateRanges.map(async (dateRange) => {
            const url = `/api/historical/indicesHistory?indexType=${encodeURIComponent(index.toUpperCase())}` +
                `&from=${dateRange.start}&to=${dateRange.end}`
            return this.getDataByEndpoint<IndexHistoricalData>(url)
        })
        return Promise.all(promises)
    }

    /**
     * 
     * @param indexSymbol 
     * @returns 
     */
    getIndexOptionChain(indexSymbol: string): Promise<OptionChainData> {
        const url = `/api/option-chain-indices?symbol=${encodeURIComponent(indexSymbol.toUpperCase())}`
        return this.getDataByEndpoint<OptionChainData>(url)
    }

    /**
     * 
     * @param symbol 
     * @returns 
     */
    getEquityOptionChain(symbol: string): Promise<OptionChainData> {
        return this.getDataByEndpoint<OptionChainData>(`/api/option-chain-equities?symbol=${encodeURIComponent(symbol
            .toUpperCase())}`)
    }
    
    /**
         * 
         * @param symbol 
         * @returns 
         */
    getCommodityOptionChain(symbol: string): Promise<OptionChainData> {
        return this.getDataByEndpoint<OptionChainData>(`/api/option-chain-com?symbol=${encodeURIComponent(symbol
            .toUpperCase())}`)
    }

    /**
     * Get NSE glossary content
     * @returns Glossary content
     */
    getGlossary(): Promise<Glossary> {
        return this.getDataByEndpoint<Glossary>(ApiList.GLOSSARY)
    }

    /**
     * Get trading holidays
     * @returns List of trading holidays
     */
    getTradingHolidays(): Promise<Holiday[]> {
        return this.getDataByEndpoint<Holiday[]>(ApiList.HOLIDAY_TRADING)
    }

    /**
     * Get clearing holidays
     * @returns List of clearing holidays
     */
    getClearingHolidays(): Promise<Holiday[]> {
        return this.getDataByEndpoint<Holiday[]>(ApiList.HOLIDAY_CLEARING)
    }

    /**
     * Get market status
     * @returns Current market status
     */
    getMarketStatus(): Promise<MarketStatus> {
        return this.getDataByEndpoint<MarketStatus>(ApiList.MARKET_STATUS)
    }

    /**
     * Get market turnover
     * @returns Market turnover data
     */
    getMarketTurnover(): Promise<MarketTurnover> {
        return this.getDataByEndpoint<MarketTurnover>(ApiList.MARKET_TURNOVER)
    }

    /**
     * Get all indices
     * @returns List of all indices
     */
    getAllIndices(): Promise<IndexDetails[]> {
        return this.getDataByEndpoint<IndexDetails[]>(ApiList.ALL_INDICES)
    }

    /**
     * Get index names
     * @returns List of index names
     */
    getIndexNames(): Promise<IndexName[]> {
        return this.getDataByEndpoint<IndexName[]>(ApiList.INDEX_NAMES)
    }

    /**
     * Get circulars
     * @returns List of circulars
     */
    getCirculars(): Promise<Circular[]> {
        return this.getDataByEndpoint<Circular[]>(ApiList.CIRCULARS)
    }

    /**
     * Get latest circulars
     * @returns List of latest circulars
     */
    getLatestCirculars(): Promise<Circular[]> {
        return this.getDataByEndpoint<Circular[]>(ApiList.LATEST_CIRCULARS)
    }

    /**
     * Get equity master
     * @returns Equity master data with categorized indices
     */
    getEquityMaster(): Promise<EquityMaster> {
        return this.getDataByEndpoint<EquityMaster>(ApiList.EQUITY_MASTER)
    }

    /**
     * Get pre-open market data
     * @returns Pre-open market data
     */
    getPreOpenMarketData(): Promise<PreOpenMarketData[]> {
        return this.getDataByEndpoint<PreOpenMarketData[]>(ApiList.MARKET_DATA_PRE_OPEN)
    }

    /**
     * Get merged daily reports for capital market
     * @returns Daily reports for capital market
     */
    getMergedDailyReportsCapital(): Promise<DailyReport[]> {
        return this.getDataByEndpoint<DailyReport[]>(ApiList.MERGED_DAILY_REPORTS_CAPITAL)
    }

    /**
     * Get merged daily reports for derivatives
     * @returns Daily reports for derivatives
     */
    getMergedDailyReportsDerivatives(): Promise<DailyReport[]> {
        return this.getDataByEndpoint<DailyReport[]>(ApiList.MERGED_DAILY_REPORTS_DERIVATIVES)
    }

    /**
     * Get merged daily reports for debt market
     * @returns Daily reports for debt market
     */
    getMergedDailyReportsDebt(): Promise<DailyReport[]> {
        return this.getDataByEndpoint<DailyReport[]>(ApiList.MERGED_DAILY_REPORTS_DEBT)
    }
}
