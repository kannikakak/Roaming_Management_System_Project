"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setRoutes = void 0;
const authRoutes_1 = require("./authRoutes");
const setRoutes = (app, dbPool) => {
    app.use('/api/auth', (0, authRoutes_1.authRoutes)(dbPool));
};
exports.setRoutes = setRoutes;
